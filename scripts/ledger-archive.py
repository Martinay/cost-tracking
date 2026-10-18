#!/usr/bin/env python3
"""Create and verify independent copies of immutable JSONL ledger streams."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
from datetime import datetime, timezone


MANIFEST_NAME = "manifest.json"
MANIFEST_VERSION = 1


class ArchiveError(Exception):
    pass


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def ensure_no_symlinks(path: Path) -> None:
    if path.is_symlink():
        raise ArchiveError(f"Symbolic links are not accepted: {path}")


def parse_stream(path: Path, relative_path: str) -> tuple[bytes, dict]:
    ensure_no_symlinks(path)
    data = path.read_bytes()
    if data and not data.endswith(b"\n"):
        raise ArchiveError(f"Unterminated final event line: {relative_path}")

    parts = Path(relative_path).parts
    if len(parts) != 3 or parts[0] != "users":
        raise ArchiveError(f"Invalid stream path: {relative_path}")
    directory_hash = parts[1]
    filename_hash = parts[2]
    if not filename_hash.startswith("events_") or not filename_hash.endswith(".jsonl"):
        raise ArchiveError(f"Invalid event stream filename: {relative_path}")
    filename_hash = filename_hash[len("events_"):-len(".jsonl")]
    if len(directory_hash) != 64 or filename_hash != directory_hash:
        raise ArchiveError(f"Subject hash path mismatch: {relative_path}")

    lines = data.splitlines()
    subject = None
    for expected_version, line in enumerate(lines, start=1):
        try:
            event = json.loads(line)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ArchiveError(f"Invalid event JSON in {relative_path} at line {expected_version}: {error}") from error
        if not isinstance(event, dict):
            raise ArchiveError(f"Event must be a JSON object: {relative_path}:{expected_version}")
        current_subject = event.get("subject")
        current_version = event.get("streamVersion")
        if not isinstance(current_subject, str) or not current_subject:
            raise ArchiveError(f"Missing event subject: {relative_path}:{expected_version}")
        if type(current_version) is not int or current_version != expected_version:
            raise ArchiveError(f"Non-contiguous stream version in {relative_path}: expected {expected_version}")
        current_hash = hashlib.sha256(current_subject.encode("utf-8")).hexdigest()
        if current_hash != directory_hash:
            raise ArchiveError(f"Event subject does not match hashed path: {relative_path}:{expected_version}")
        if subject is None:
            subject = current_subject
        elif current_subject != subject:
            raise ArchiveError(f"Mixed subjects in event stream: {relative_path}")

    count = len(lines)
    return data, {
        "path": relative_path,
        "sha256": digest(data),
        "eventCount": count,
        "lastVersion": count,
    }


def stream_files(root: Path) -> list[Path]:
    users = root / "users"
    ensure_no_symlinks(root)
    ensure_no_symlinks(users)
    if not users.is_dir():
        raise ArchiveError(f"Ledger root must contain a users directory: {root}")
    files = []
    for path in users.rglob("events_*.jsonl"):
        ensure_no_symlinks(path)
        if not path.is_file():
            raise ArchiveError(f"Event stream is not a regular file: {path}")
        files.append(path)
    return sorted(files)


def validate_stream_tree(root: Path) -> list[tuple[Path, bytes, dict]]:
    result = []
    for path in stream_files(root):
        relative = path.relative_to(root).as_posix()
        data, record = parse_stream(path, relative)
        result.append((path, data, record))
    return result


def fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_manifest(directory: Path, records: list[dict]) -> None:
    manifest = {
        "formatVersion": MANIFEST_VERSION,
        "createdAtUtc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "streams": records,
    }
    content = (json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n").encode()
    path = directory / MANIFEST_NAME
    with path.open("xb") as file:
        file.write(content)
        file.flush()
        os.fsync(file.fileno())


def read_manifest(directory: Path) -> tuple[dict, list[tuple[Path, bytes, dict]]]:
    ensure_no_symlinks(directory)
    manifest_path = directory / MANIFEST_NAME
    ensure_no_symlinks(manifest_path)
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ArchiveError(f"Cannot read archive manifest: {error}") from error
    if not isinstance(manifest, dict) or manifest.get("formatVersion") != MANIFEST_VERSION:
        raise ArchiveError("Unsupported or invalid archive manifest format.")
    records = manifest.get("streams")
    if not isinstance(records, list):
        raise ArchiveError("Archive manifest has no stream list.")

    verified = []
    seen = set()
    for record in records:
        if not isinstance(record, dict) or not isinstance(record.get("path"), str):
            raise ArchiveError("Invalid stream record in archive manifest.")
        relative = Path(record["path"])
        if relative.is_absolute() or ".." in relative.parts or relative.parts[:1] != ("users",):
            raise ArchiveError(f"Unsafe path in archive manifest: {record.get('path')}")
        normalized = relative.as_posix()
        if normalized in seen:
            raise ArchiveError(f"Duplicate path in archive manifest: {normalized}")
        seen.add(normalized)
        path = directory / relative
        try:
            data, actual = parse_stream(path, normalized)
        except OSError as error:
            raise ArchiveError(f"Cannot read archived stream {normalized}: {error}") from error
        if actual != record:
            raise ArchiveError(f"Archived stream integrity mismatch: {normalized}")
        verified.append((path, data, actual))

    actual_files = set()
    for path in directory.rglob("*"):
        ensure_no_symlinks(path)
        if not path.is_file():
            continue
        relative = path.relative_to(directory).as_posix()
        if relative != MANIFEST_NAME and not relative.startswith("users/"):
            raise ArchiveError(f"Unexpected non-ledger file in archive: {relative}")
        if relative != MANIFEST_NAME and not Path(relative).name.startswith("events_"):
            raise ArchiveError(f"Unexpected file in archive: {relative}")
        if relative != MANIFEST_NAME:
            actual_files.add(relative)
    if actual_files != seen:
        raise ArchiveError("Archive contains missing or unlisted event streams.")
    return manifest, verified


def atomic_directory(destination: Path, build) -> None:
    parent = destination.parent
    parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() or destination.is_symlink():
        raise ArchiveError(f"Destination must not already exist: {destination}")
    temporary = Path(tempfile.mkdtemp(prefix=f".{destination.name}.tmp-", dir=parent))
    try:
        os.chmod(temporary, 0o700)
        build(temporary)
        fsync_directory(temporary)
        if destination.exists() or destination.is_symlink():
            raise ArchiveError(f"Destination appeared while preparing archive: {destination}")
        temporary.rename(destination)
        fsync_directory(parent)
    except Exception:
        shutil.rmtree(temporary, ignore_errors=True)
        raise


def backup(source: Path, destination: Path, writers_stopped: bool) -> None:
    if not writers_stopped:
        raise ArchiveError("Pass --writers-stopped only after stopping all ledger writers.")
    source = source.resolve(strict=True)
    destination = destination.absolute()
    if not source.is_dir():
        raise ArchiveError(f"Source root is not a directory: {source}")
    if destination == source or source in destination.parents or destination in source.parents:
        raise ArchiveError("Independent backup destination must be outside the source root.")
    streams = validate_stream_tree(source)

    def build(temporary: Path) -> None:
        records = []
        for _, data, record in streams:
            target = temporary / record["path"]
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            with target.open("xb") as file:
                file.write(data)
                file.flush()
                os.fsync(file.fileno())
            records.append(record)
        write_manifest(temporary, records)

    atomic_directory(destination, build)
    print(f"Backup created with {len(streams)} verified ledger stream(s): {destination}")


def verify(archive: Path) -> None:
    archive = archive.resolve(strict=True)
    _, streams = read_manifest(archive)
    print(f"Backup verified: {len(streams)} ledger stream(s); manifest checksums and event prefixes match.")


def restore(archive: Path, destination: Path, writers_stopped: bool) -> None:
    if not writers_stopped:
        raise ArchiveError("Pass --writers-stopped only after stopping all ledger writers and selecting a fresh data root.")
    archive = archive.resolve(strict=True)
    destination = destination.absolute()
    if destination == archive or archive in destination.parents or destination in archive.parents:
        raise ArchiveError("Restore destination must be separate from the backup directory.")
    _, streams = read_manifest(archive)

    def build(temporary: Path) -> None:
        for _, data, record in streams:
            target = temporary / record["path"]
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            with target.open("xb") as file:
                file.write(data)
                file.flush()
                os.fsync(file.fileno())

    atomic_directory(destination, build)
    print(f"Restored verified backup to fresh data root: {destination}")


def parser() -> argparse.ArgumentParser:
    command = argparse.ArgumentParser(description=__doc__)
    subcommands = command.add_subparsers(dest="command", required=True)
    backup_command = subcommands.add_parser("backup", help="copy verified event streams to a new independent destination")
    backup_command.add_argument("source", type=Path)
    backup_command.add_argument("destination", type=Path)
    backup_command.add_argument("--writers-stopped", action="store_true")
    restore_command = subcommands.add_parser("restore", help="restore a verified archive into a new empty data root")
    restore_command.add_argument("archive", type=Path)
    restore_command.add_argument("destination", type=Path)
    restore_command.add_argument("--writers-stopped", action="store_true")
    verify_command = subcommands.add_parser("verify", help="verify manifest, checksums and stream prefixes without changing data")
    verify_command.add_argument("archive", type=Path)
    return command


def main() -> int:
    arguments = parser().parse_args()
    try:
        if arguments.command == "backup":
            backup(arguments.source, arguments.destination, arguments.writers_stopped)
        elif arguments.command == "restore":
            restore(arguments.archive, arguments.destination, arguments.writers_stopped)
        else:
            verify(arguments.archive)
    except (ArchiveError, OSError, ValueError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
