# VanillaWarp ⚡

A high-speed, zero-trust peer-to-peer (P2P) file-sharing platform built with **Core Java** and **WebRTC**. VanillaWarp completely bypasses cloud servers, allowing devices to establish direct, end-to-end encrypted local network bridges for multi-gigabyte file transfers. 

Developed as a Semester 5 Computer Science Engineering Java project at MIT World Peace University (MIT-WPU).

---

## ✨ Key Features

- **Zero-Trust Architecture:** Files are never uploaded to a central server. The Java backend acts strictly as a signaling broker (Control Plane) and never touches the data payload.
- **End-to-End Encryption:** Uses the Web Crypto API to derive AES-256-GCM keys locally via PBKDF2 (100,000 iterations). Every chunk is encrypted with a fresh Initialization Vector (IV).
- **Turbo Mode:** Dynamically scales file chunking up to 250KB with an 8MB backpressure buffer to saturate local LAN bandwidth for high-speed desktop-to-desktop transfers.
- **Zero-RAM Streaming:** Decrypted chunks are streamed directly to the hard drive in real-time using the modern File System Access API, keeping the browser memory footprint near zero regardless of file size.
- **Auto-Tunneling Daemon:** Java automatically spawns a background SSH process (`localhost.run`) to securely expose the local server to the public internet without manual port forwarding.
- **Live Telemetry & Rate Limiting:** A built-in SQLite database logs connection metrics. The server implements an IP-based Token Bucket algorithm to prevent DDoS attacks (max 5 room creations per minute).

---

## 🛠️ Technology Stack

* **Backend (Control Plane):** Core Java 17+ 
  * `com.sun.net.httpserver` (Native HTTP Networking)
  * `java.util.concurrent` (Thread Pools & ConcurrentHashMaps)
  * `java.lang.ProcessBuilder` (OS-level daemon orchestration)
* **Database:** SQLite (via JDBC)
* **Frontend (Data Plane):** Vanilla HTML5, CSS3 (Glassmorphism UI), JavaScript, WebRTC (SCTP Data Channels)

*(Note: The backend was intentionally built from scratch without heavy frameworks like Spring Boot to demonstrate a deep understanding of low-level systems architecture, networking, and concurrency).*

---

## ⚙️ Architecture: Control Plane vs. Data Plane

1. **Java Backend (Control Plane):** Authenticates sessions, enforces rate limits, and brokers the SDP (Session Description Protocol) handshake between peers asynchronously using cached thread pools.
2. **JavaScript Frontend (Data Plane):** Strips out TURN server fallbacks to force WebRTC to build a direct local network bridge (e.g., via mobile hotspots), achieving maximum SSD write speeds while bypassing Carrier Grade NAT (CGNAT) and Enterprise AP Isolation firewalls.

---

## 🚀 How to Run Locally

### Prerequisites
* **Java Development Kit (JDK) 17** or higher installed.
* **SQLite JDBC Driver** (`sqlite-jdbc.jar`) placed in the project root directory.

### Installation & Execution

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/Sarthak23Deodhar/VanillaWarp-Peer2PeerFileTransfer.git](https://github.com/Sarthak23Deodhar/VanillaWarp-Peer2PeerFileTransfer.git)
   cd VanillaWarp-Peer2PeerFileTransfer
