# RSI sdraw plugin

This is an independent checkout of sdraw, integrated with RSI Console. Preserve
upstream history and the existing `.sdraw` JSON format. HTML and JSON must share
one editor model; do not fork canvas behavior by file extension.

Use straightforward control flow and small, purposeful functions. Preserve
unknown fields, stable IDs, plot code references, source provenance and caches
when converting formats. Never execute Python merely to open or convert a file.
Keep synthetic examples public and real boards outside the repository.

Read HTML_FORMAT.md before changing serialization. HTML v1 supports an explicit
canvas contract, not arbitrary webpage round-tripping. Do not silently claim or
introduce compatibility with unsupported HTML/CSS edits.

Verify backend format/API tests and the frontend production build. Test the
mounted plugin with RSI Console when changing URLs or WebSockets. Do not modify
the original sdraw checkout or its uncommitted work. Do not commit or push unless
requested; run RSI Console publication guards before publication.
