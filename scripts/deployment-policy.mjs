import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function isTrustedDeployment(eventName, ref) {
  return ref === "refs/heads/main" && eventName === "workflow_dispatch";
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [eventName, ref] = process.argv.slice(2);
  if (!isTrustedDeployment(eventName, ref)) {
    console.error("Deployment is restricted to manual runs on main.");
    process.exitCode = 1;
  }
}
