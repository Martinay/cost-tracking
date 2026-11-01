# Research

## Decision
Use the existing native View link with a card-sized pseudo-element and a relative card container.

## Rationale
The card contains no other interactive elements. This preserves the existing appearance, one tab stop, encoded destination, accessible name, browser context menu and modified clicks. CSS hit testing needs a running-browser regression rather than jsdom assertions. Research inspected existing horse markup, styles and language browser fixtures.

## Alternatives considered
A wrapping anchor requires retargeting font, spacing and badge selectors. A card click handler adds keyboard and modified-click responsibilities already handled by native links. Both add unnecessary change.

## Feedback
Use the existing brand border on hover and the canonical 3px focus outline with 3px offset across the card. No motion required. No unresolved questions.
