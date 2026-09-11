# Tenki browser and saved workspace

The optional adapter controls the existing, explicitly allowed demonstration computer. It never creates a VM. The recorded session and resource tuple remain fixed in src/tenki-browser.ts; the portable SDK import points to this package’s pinned @tenkicloud/sandbox1.0.6. No SDK key, private allowance or runtime state is exported. This historical session expires; reproducing on a new operator-owned computer requires a newly reviewed binding and allowance, not silently reusing its identity.

The fixed scripts/tenki-browser-read.mjs reads the permitted supplier catalog and saves a real screenshot. Playwright1.56.0 is the patched distribution dependency. The original recording used1.55.0; ROOT’s later guest runtime and executable selection need their own receipt. No worker starts a local browser during package selfcheck.

public-cloud/index.html, app.js and style.css display saved status/capture/approved handoff artifacts supplied by the running adapter. Without those runtime artifacts there is no activity to display. public-cloud/desktop.html is the separate read-only noVNC front end; its relative core/rfb.js and websockify endpoint come from the operator’s noVNC installation, which is not vendored here. It cannot become a live desktop by opening the HTML alone.

The original saved preview ends3:29PM PDT and desktop viewer3:12PM PDT on September11. Canonical public-showcase configuration (exported to docs/showcase-config.json) supplies exact URLs/expiries. The standalone event companion uses its own8081 runtime and3:15PM expiry; see event-workspace/README.md. Durable recording, source and captions are separate static assets.
