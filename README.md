# VanillaWarp

Share files between browsers with a short code, without recipient accounts. The sender approves the connection and **both people compare eight words using a trusted separate call or chat**. File data travels over encrypted WebRTC, directly when possible or through an optional TURN relay. The Java server on the owner's laptop only coordinates connections; GitHub Pages hosts the website.

## Before you start

- A **public GitHub repository** with GitHub Pages and Actions enabled. Public-repository Pages and standard GitHub-hosted Actions are generally free, subject to GitHub's limits and policies. Private repositories have different eligibility and quotas; do not assume they are free.
- On the Windows laptop: JDK **17 or newer** (`java` and `javac` on PATH), Git, [GitHub CLI](https://cli.github.com/), and Windows OpenSSH Client (`ssh`). Sign in locally with `gh auth login`. Never share your GitHub credentials or token.
- Desktop Chrome or Edge over HTTPS (or localhost) is recommended. Mobile browsers can send and receive individual files, subject to download and memory limits below. **Complete folder reception including empty subfolders requires destination-directory access**, usually desktop Chrome or Edge. Sending can also use a supported desktop folder drop (including Firefox and Brave).

## One-time GitHub Pages setup

1. Clone your public repository on the Windows laptop. The current branch must exist on the remote and contain this app and `.github/workflows/pages.yml`.
2. The `Publish VanillaWarp` workflow must **also exist on the repository's default branch** before GitHub will accept a manual `workflow_dispatch`. Merge the workflow and app into the default branch using your normal review process. This project does not push or merge for you.
3. In repository **Settings → Pages → Build and deployment**, choose **GitHub Actions**. Ensure Actions and Pages deployment are allowed by repository settings. If GitHub requires approval for the `github-pages` environment, approve it on GitHub.
4. In the clone, check out the branch you want published and push its current code. The script uses the current branch and `gh repo view`'s repository. The supported website address is the default `https://OWNER.github.io/REPO/` (or `https://OWNER.github.io/` for an `OWNER.github.io` repository); custom domains and GitHub Enterprise are not configured automatically.

## Run on Windows

Double-click **`run.bat`**. It compiles the Java server, starts it and a public localhost.run SSH tunnel, and dispatches the Pages workflow with the new public tunnel address. It opens the local interface in your browser if possible. Keep the window, laptop and internet connection running and prevent the laptop from sleeping. The server prints **`Ready: https://...`** once the published config matches the current tunnel. Share that Pages URL, not `localhost`, with others.

The first run and each tunnel reconnection may take several minutes while GitHub deploys. If publishing fails, inspect the `Publish VanillaWarp` workflow in GitHub Actions and confirm the prerequisites above. A stale Pages address shows **Server offline** until the host is back and the new deployment is live; refresh the status with ↻. If `gh`/Git aren't configured, the local interface still runs, but remote Pages publishing won't work. The tunnel exposes the server publicly. Closing the window or losing connectivity stops sharing.

The `setup.bat` script only compiles; it does not start the server. To run locally on macOS/Linux, from the project root:

```sh
mkdir -p out/vanillawarp
javac -d out/vanillawarp src/com/transfer/network/WebRelayServer.java src/com/transfer/gui/P2PApplicationGUI.java
java -cp out/vanillawarp WebRelayServer
```

Open `http://localhost:8080/` on that same computer. `PORT` changes the port. This local command does not automatically configure or publish Pages. The optional Java Swing entry point is a browser launcher, not a second transfer engine: `java -cp out/vanillawarp com.transfer.gui.P2PApplicationGUI`.

## Appearance

The moon/sun button switches between light and dark appearances. Initially the site follows your device's color scheme; an explicit choice is saved in this browser's local storage. No transfer code, file list or key is saved there. The brief splash is decorative, does not block interaction and is skipped when reduced motion is requested. The session stepper reflects connection, verification, transfer and completion; a stopped transfer stays marked at its last stage.

## Send and receive

1. Sender opens VanillaWarp, chooses files or a folder, reviews the selection, and creates a transfer. Share the 8-character code privately.
2. Receiver opens the same Pages site, enters the code, chooses **ask**, **skip**, **replace**, or **recover** for existing files, then chooses a destination where supported. Under **ask**, each existing file requires confirmation; cancelling the prompt skips it. Folder structure, including empty directories, is created under the chosen destination. Unrelated files are not deleted.
3. Once connected, **compare all eight displayed words exactly over an independently trusted channel**. If they differ or the other person is not who you expected, cancel. Receiver confirms and sender explicitly approves. No file names or contents are sent until both confirm.
4. Keep both tabs open until complete. Either person can pause and resume; if both paused, both must resume. Already-buffered chunks may finish saving after a pause. Pause does not survive a closed tab, disconnect or restart. Cancel stops the transfer; already-saved files and created directories can remain. After a successful transfer the code, selection and other form state are cleared; a completion summary distinguishes transferred files, verified existing files, and skipped files. On browsers without the directory picker, file reception uses browser downloads, limited to **128 MiB per file**. Your browser may request permission for multiple downloads and controls download conflicts; the in-app conflict policy applies when saving to a chosen destination folder. Completion reports that downloads were *initiated*, not that the browser saved them. Connection stages, guidance on failures and confirmed partial counts help both people understand what happened. Folder transfer is blocked rather than silently omitting directories on unsupported browsers.

### Recovering after a disconnect or restart

Recovery is manual and **file-level**, not a byte-level resume. After an interruption, the sender starts a new transfer with the same source files/folder, shares the new code, and the receiver chooses **Recover** and the same destination. Both people must compare and approve the new eight-word phrase. For each existing same-size file, both peers independently stream SHA-256 of their copies; an exact match is reused without retransmitting. A size or checksum difference always prompts before replacement; cancel skips it. Missing files are transferred normally. Empty subfolders are preserved. Incomplete individual files start again from the beginning, and an interrupted file may remain empty or partially saved depending on the browser; there are no durable byte checkpoints. Avoid changing source or destination files while checking or transferring. The stopped-transfer screen provides a Start recovery action for each person, with steps to reselect or review the source and re-enter the new code. No transfer keys or manifest are stored for recovery.

Recovery reads every candidate existing file on **both** devices, consuming disk bandwidth and CPU; for a huge folder it can take a long time. Hashing is incremental (bounded 4 MiB blocks), not loaded into RAM as one file, and can be paused/cancelled. File completion/checksum waits time out after 24 hours. Destination-folder access is required; the download fallback cannot verify previously saved files.

### Optional saved-file verification

The receiver can enable **Verify saved files after transfer** before connecting. The sender rereads each source file and the receiver rereads each saved file independently using streaming SHA-256; a mismatch stops the transfer and is reported. A mismatching file may remain on disk and must be checked or replaced. This checks the saved snapshot, not later changes, and is not malware scanning. It requires direct destination-folder access, not browser downloads. It is **off by default**: it adds an entire read on both devices and CPU work, so leave it off for the fastest transfer. The normal encrypted streaming path already authenticates every chunk but does not independently reread saved files.

### Folder support and speed

- If a browser has no folder picker, **drag one folder onto the send panel**. The desktop drag-and-drop directory API is used to include nested and empty directories. If the browser cannot provide the complete tree, the app rejects the selection rather than silently dropping folders. The folder input fallback is intentionally not used because it omits empty directories.
- Receiving complete folders directly requires a browser that exposes `showDirectoryPicker` with write access. Firefox does not currently provide this, so Firefox cannot receive a complete folder with this direct-saving mode. It can still receive individual files using browser downloads.
- Brave commonly disables File System Access by default. If you choose to change this browser-wide privacy setting, look for `brave://flags/#file-system-access-api`, enable it and restart Brave; flag availability may vary by version. Only enable it if you accept the privacy/security implications. Alternatively use desktop Chrome or Edge for direct folder reception. VanillaWarp never changes browser settings automatically.
- Transfer chunk size is negotiated. The sender adjusts its acknowledgement window using observed response time and queued data, capped at 256 messages / 16 MiB of unacknowledged ciphertext. Up to four additional chunks may be prepared concurrently, and the browser send queue is also bounded. File-end and next-file requests overlap without bypassing conflict checks. The progress view shows observed throughput; expandable connection details show an approximate ETA and direct/relay route and round-trip time when the browser reports them. An unavailable route is not guessed, and file checks are labelled separately from transfer speed. Speed is not guaranteed: upload/download bandwidth, latency, disk, device, browser, and direct versus relay routing all matter. No paid relay is enabled by default.
- A 140 GB folder is theoretically streamed without loading it all into RAM, but has **not been tested at that scale**. It needs sufficient free destination disk space, awake devices and a stable connection; browser temporary files and filesystem limits may require extra space.
- This version uses protocol v6 for authenticated file chunks and pause/resume; both people should refresh and use the same current version.

## Worldwide connectivity and optional relay

VanillaWarp tries ordinary WebRTC connectivity first. This can work across networks worldwide, but **not every network allows a direct connection**. VPNs, carrier NAT, firewalls, restricted networks, tunnel/provider outages and an offline laptop can prevent a transfer. The default configuration has **no TURN relay and no paid service**.

[Metered Open Relay](https://www.metered.ca/tools/openrelay/) advertises a free allowance (currently 20 GB/month at the time of writing) and requires a provider account/API key. Provider pricing and terms can change; 20 GB of relay traffic does not necessarily mean 20 GB of user files. We have **not verified a hard free-only cap or no-overage guarantee**, so the relay is disabled by default. Do not enable it unless you have independently confirmed a hard cap/no billing exposure for your account and accept the provider's terms. A public endpoint could be abused and exhaust a quota. Never put the provider API key in the website, Git, screenshots or chat.

If you have verified those conditions, set `VANILLAWARP_TURN_API_URL` **locally on the laptop** before running `run.bat`, to the exact HTTPS Metered credentials endpoint shown in your own provider dashboard (host ending `.metered.live`, path `/api/v1/turn/credentials`, API key in its query). The server fetches ICE credentials for authorized room participants; the provider-issued relay credentials themselves are delivered to the peers. If the provider is unavailable the app falls back to direct/STUN only. The root API URL is not published to Pages. This implementation does not provide a quota meter or automatic hard stop.

## Security and privacy

The code is a room locator, **not a secret or proof of identity**. Each side generates an ephemeral P-256 ECDH key, derives AES-GCM encryption keys, and derives an eight-word verification phrase (40 bits) from the code, both public keys and complete WebRTC offer/answer (including DTLS fingerprints). Comparing the words over an independently trusted channel detects active signaling substitution with the security of the short phrase; it is essential, not optional. WebRTC also encrypts its data channel. The signaling service sees room activity, SDP/network metadata and whether the transfer is a folder. TURN/STUN operators can see network metadata; TURN relays encrypted traffic.

A malicious server, laptop, Pages deployment, browser extension or modified client code can compromise the transfer; comparing words cannot protect against a site that serves malicious JavaScript. Each encrypted chunk also authenticates its file index, path, declared size and offset. A per-transfer prefix and monotonic counter make AES-GCM nonces unique under the ephemeral transfer key and allow replay/out-of-order chunks to be rejected. Filename components, folder depth, incoming frame sizes and queued data are bounded; unsupported or invalid paths stop the transfer rather than being silently changed. Limits include 256 path components, 1,024 UTF-16 code units per component and 65,536 total. Some filesystems impose smaller limits. An interrupted or rejected transfer may still leave created directories or an empty file; previously completed files are not rolled back.

Only use a trusted Pages deployment and devices. A restrictive Content Security Policy is included in the page, and API responses use no-sniff and no-cache headers. Signaling submissions are authenticated before their body is read. Public signaling can still be abused or denial-of-serviced; per-address rate limits and a 128-active-room cap are best effort, and tunnel traffic may share an address. Rooms expire after 10 minutes for signaling; established transfers can continue.

The sender knows the file contents, and a verified but malicious sender can intentionally send harmful files. VanillaWarp does **not** scan files for malware. Check unexpected files with trusted security software and don't run them without verifying their source. GitHub Actions is configured for dependency auditing and CodeQL analysis, with Dependabot update proposals (subject to GitHub repository eligibility and settings); these automated checks cannot guarantee security or replace a review. This project has not had an independent security audit and should not be used for high-risk data without one.

## Tests

After compiling, run the server and static checks:

```sh
npm ci
npm run check:hash
npm audit --audit-level=high
VANILLAWARP_TEST_CLASSPATH=out/vanillawarp npm test
```

For browser-to-browser WebRTC tests, start the Java server separately and install Playwright's Chromium:

```sh
npx playwright install chromium firefox
VANILLAWARP_BROWSER_URL=http://127.0.0.1:8080/ npm run test:browser
```

Set `VANILLAWARP_BROWSER_ENGINE=firefox` to run the browser suite with Playwright Firefox instead. On Windows Command Prompt, use `set VARIABLE=value` before each command. Automated axe checks cover representative desktop/mobile and transfer states, alongside keyboard-focus and touch-target checks; they are not a substitute for manual screen-reader or device testing. The browser tests use real WebRTC connections with **mocked filesystem picker and folder-drop entries**; they do not test native operating-system dialogs or real Brave/Firefox folder drag gestures, real internet relay behavior, GitHub deployment, or Windows startup. Tests requiring a server URL/classpath are skipped when the corresponding environment variable is absent.

The optional checksum implementation bundles `@noble/hashes` 1.8.0 (MIT; full license in `resources/HASH-LICENSE.txt` and the generated bundle). Run `npm run build:hash` after updates; CI verifies the committed bundle is reproducible.

### Controlled speed comparison

With the server running and Chromium installed, `VANILLAWARP_BROWSER_URL=http://127.0.0.1:8080/ npm run benchmark` compares the current client with isolated previous scheduling behaviors. It uses loopback WebRTC, mocked disk writes and optionally delayed acknowledgements; results are illustrative, not a measurement of internet speed or real disk throughput. On Windows Command Prompt, set the variable separately before running the command.
