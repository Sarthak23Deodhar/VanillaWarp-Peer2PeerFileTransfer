# VanillaWarp

Share files between browsers with a short code, without recipient accounts. The sender approves the connection and **both people compare six words using a trusted separate call or chat**. File data travels over encrypted WebRTC, directly when possible or through an optional TURN relay. The Java server on the owner's laptop only coordinates connections; GitHub Pages hosts the website.

## Before you start

- A **public GitHub repository** with GitHub Pages and Actions enabled. Public-repository Pages and standard GitHub-hosted Actions are generally free, subject to GitHub's limits and policies. Private repositories have different eligibility and quotas; do not assume they are free.
- On the Windows laptop: JDK **17 or newer** (`java` and `javac` on PATH), Git, [GitHub CLI](https://cli.github.com/), and Windows OpenSSH Client (`ssh`). Sign in locally with `gh auth login`. Never share your GitHub credentials or token.
- Desktop Chrome or Edge over HTTPS (or localhost) is recommended. Mobile browsers can send and receive individual files, subject to download and memory limits below. **Complete folders including empty subfolders require directory-picker support on both devices**, usually desktop Chromium-based browsers.

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

## Send and receive

1. Sender opens VanillaWarp, chooses files or a folder, reviews the selection, and creates a transfer. Share the 8-character code privately.
2. Receiver opens the same Pages site, enters the code, chooses **ask**, **skip**, or **replace** for existing files, then chooses a destination where supported. Under **ask**, each existing file requires confirmation; cancelling the prompt skips it. Folder structure, including empty directories, is created under the chosen destination. Unrelated files are not deleted.
3. Once connected, **compare all six displayed words exactly over an independently trusted channel**. If they differ or the other person is not who you expected, cancel. Receiver confirms and sender explicitly approves. No file names or contents are sent until both confirm.
4. Keep both tabs open until complete. Cancel stops the transfer; already-saved files and created directories can remain. There is no resume; retry as a new transfer. On browsers without the directory picker, file reception uses browser downloads, limited to **128 MiB per file**. Your browser may request permission for multiple downloads and controls download conflicts; the in-app conflict policy applies when saving to a chosen destination folder. Completion reports that downloads were *initiated*, not that the browser saved them. Folder transfer is blocked rather than silently omitting directories on unsupported browsers.

## Worldwide connectivity and optional relay

VanillaWarp tries ordinary WebRTC connectivity first. This can work across networks worldwide, but **not every network allows a direct connection**. VPNs, carrier NAT, firewalls, restricted networks, tunnel/provider outages and an offline laptop can prevent a transfer. The default configuration has **no TURN relay and no paid service**.

[Metered Open Relay](https://www.metered.ca/tools/openrelay/) advertises a free allowance (currently 20 GB/month at the time of writing) and requires a provider account/API key. Provider pricing and terms can change; 20 GB of relay traffic does not necessarily mean 20 GB of user files. We have **not verified a hard free-only cap or no-overage guarantee**, so the relay is disabled by default. Do not enable it unless you have independently confirmed a hard cap/no billing exposure for your account and accept the provider's terms. A public endpoint could be abused and exhaust a quota. Never put the provider API key in the website, Git, screenshots or chat.

If you have verified those conditions, set `VANILLAWARP_TURN_API_URL` **locally on the laptop** before running `run.bat`, to the exact HTTPS Metered credentials endpoint shown in your own provider dashboard (host ending `.metered.live`, path `/api/v1/turn/credentials`, API key in its query). The server fetches ICE credentials for authorized room participants; the provider-issued relay credentials themselves are delivered to the peers. If the provider is unavailable the app falls back to direct/STUN only. The root API URL is not published to Pages. This implementation does not provide a quota meter or automatic hard stop.

## Security and privacy

The code is a room locator, **not a secret or proof of identity**. Each side generates an ephemeral P-256 ECDH key, derives AES-GCM encryption keys, and derives a six-word verification phrase from the code, both public keys and complete WebRTC offer/answer (including DTLS fingerprints). Comparing the words over an independently trusted channel detects active signaling substitution with the security of the short phrase; it is essential, not optional. WebRTC also encrypts its data channel. The signaling service sees room activity, SDP/network metadata and whether the transfer is a folder. TURN/STUN operators can see network metadata; TURN relays encrypted traffic.

A malicious server, laptop, Pages deployment, browser extension or modified client code can compromise the transfer; comparing words cannot protect against a site that serves malicious JavaScript. Only use a trusted Pages deployment and devices. Public signaling can be abused or denial-of-serviced; rate limits are best effort and tunnel traffic may share an address. Rooms expire after 10 minutes for signaling; established transfers can continue. This project has not had an independent security audit and should not be used for high-risk data without one.

## Tests

After compiling, run the server and static checks:

```sh
npm ci
VANILLAWARP_TEST_CLASSPATH=out/vanillawarp npm test
```

For browser-to-browser WebRTC tests, start the Java server separately and install Playwright's Chromium:

```sh
npx playwright install chromium
VANILLAWARP_BROWSER_URL=http://127.0.0.1:8080/ npm run test:browser
```

On Windows Command Prompt, use `set VARIABLE=value` before each command. The browser tests use real Chromium WebRTC connections with a **mocked filesystem picker**; they do not test native operating-system dialogs, real internet relay behavior, GitHub deployment, or Windows startup. Tests requiring a server URL/classpath are skipped when the corresponding environment variable is absent.
