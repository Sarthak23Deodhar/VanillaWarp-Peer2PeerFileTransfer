/* VanillaWarp signaling server. File contents travel over WebRTC, never this server. */
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;
import java.io.*;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

public class WebRelayServer {
    private static final int PORT = Integer.parseInt(System.getenv().getOrDefault("PORT", "8080"));
    private static final String PAGES_ORIGIN = System.getenv().getOrDefault("VANILLAWARP_PAGES_ORIGIN", "");
    private static final String TURN_URL = System.getenv().getOrDefault("VANILLAWARP_TURN_API_URL", "");
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Map<String, RoomState> rooms = new ConcurrentHashMap<>();
    private static final Map<String, AtomicInteger> roomRequests = new ConcurrentHashMap<>();
    private static final Map<String, AtomicInteger> signalRequests = new ConcurrentHashMap<>();
    private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(8)).followRedirects(HttpClient.Redirect.NEVER).build();
    private static volatile String tunnelUrl;
    private static volatile Process tunnelProcess;
    private static final Object PUBLISH_LOCK = new Object();
    private static volatile boolean published;
    private static final int MAX_BODY = 262144;
    private static final int MAX_ROOMS = 128;
    private static final long ROOM_LIFETIME = 10 * 60 * 1000L;
    private static final String STUN = "{\"iceServers\":[{\"urls\":\"stun:stun.cloudflare.com:3478\"}],\"relay\":false}";

    private static final class RoomState {
        final String ownerToken;
        final long createdAt = System.currentTimeMillis();
        String offer, answer, joinToken;
        int ownerIce, joinIce;
        RoomState(String token) { ownerToken = token; }
    }

    public static void main(String[] args) throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress(PORT), 0);
        server.createContext("/", WebRelayServer::staticFile);
        server.createContext("/api/status", api(exchange -> {
            if (!method(exchange, "GET")) return;
            json(exchange, 200, "{\"online\":true,\"relayConfigured\":" + !TURN_URL.isBlank() + ",\"published\":" + published + "}");
        }));
        server.createContext("/api/room/create", api(WebRelayServer::createRoom));
        server.createContext("/api/room/join", api(WebRelayServer::joinRoom));
        server.createContext("/api/room/cancel", api(WebRelayServer::cancelRoom));
        server.createContext("/api/offer", api(exchange -> signaling(exchange, true)));
        server.createContext("/api/answer", api(exchange -> signaling(exchange, false)));
        server.createContext("/api/ice", api(WebRelayServer::iceServers));
        server.setExecutor(Executors.newFixedThreadPool(16));
        server.start();
        System.out.println("VanillaWarp listening on http://localhost:" + PORT);
        if (TURN_URL.isBlank()) System.out.println("Free relay not configured: direct connections only. See README.");
        Executors.newSingleThreadScheduledExecutor().scheduleAtFixedRate(() -> {
            long now = System.currentTimeMillis();
            rooms.entrySet().removeIf(e -> now - e.getValue().createdAt > ROOM_LIFETIME);
            roomRequests.clear(); signalRequests.clear();
        }, 1, 1, TimeUnit.MINUTES);
        if ("1".equals(System.getenv("VANILLAWARP_TUNNEL"))) startTunnel();
        if ("1".equals(System.getenv("VANILLAWARP_OPEN_BROWSER"))) {
            try {
                if (java.awt.Desktop.isDesktopSupported() && java.awt.Desktop.getDesktop().isSupported(java.awt.Desktop.Action.BROWSE))
                    java.awt.Desktop.getDesktop().browse(URI.create("http://localhost:" + PORT + "/"));
            } catch (Exception ignored) { System.out.println("Open http://localhost:" + PORT + "/ in your browser."); }
        }
    }

    private static HttpHandler api(HttpHandler next) {
        return exchange -> {
            exchange.getResponseHeaders().set("X-Content-Type-Options", "nosniff");
            exchange.getResponseHeaders().set("Referrer-Policy", "no-referrer");
            exchange.getResponseHeaders().set("Cache-Control", "no-store");
            if (!exchange.getRequestURI().getPath().equals(exchange.getHttpContext().getPath())) {
                json(exchange, 404, "{\"error\":\"Not found\"}"); return;
            }
            String origin = exchange.getRequestHeaders().getFirst("Origin");
            if (!PAGES_ORIGIN.isBlank() && PAGES_ORIGIN.equals(origin)) {
                exchange.getResponseHeaders().set("Access-Control-Allow-Origin", PAGES_ORIGIN);
                exchange.getResponseHeaders().set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
                exchange.getResponseHeaders().set("Access-Control-Allow-Headers", "Content-Type, X-Owner-Token, X-Join-Token");
                exchange.getResponseHeaders().set("Access-Control-Max-Age", "600");
                exchange.getResponseHeaders().add("Vary", "Origin");
            }
            if ("OPTIONS".equals(exchange.getRequestMethod())) {
                exchange.sendResponseHeaders(PAGES_ORIGIN.equals(origin) && !PAGES_ORIGIN.isBlank() ? 204 : 403, -1); exchange.close(); return;
            }
            next.handle(exchange);
        };
    }

    private static void staticFile(HttpExchange e) throws IOException {
        if (!method(e, "GET")) return;
        String path = e.getRequestURI().getPath();
        String name = switch (path) {
            case "/", "/index.html" -> "index.html";
            case "/app.js" -> "app.js";
            case "/hash.js" -> "hash.js";
            case "/styles.css" -> "styles.css";
            default -> null;
        };
        if (name == null) { text(e, 404, "Not found"); return; }
        Path file = Paths.get("resources", name);
        if (!Files.isRegularFile(file)) { text(e, 404, "App files not found; start from the project root"); return; }
        byte[] bytes = Files.readAllBytes(file);
        e.getResponseHeaders().set("Content-Type", name.endsWith(".js") ? "application/javascript; charset=UTF-8" : name.endsWith(".css") ? "text/css; charset=UTF-8" : "text/html; charset=UTF-8");
        e.getResponseHeaders().set("Cache-Control", "no-store");
        e.getResponseHeaders().set("X-Content-Type-Options", "nosniff");
        e.getResponseHeaders().set("Referrer-Policy", "no-referrer");
        e.getResponseHeaders().set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; base-uri 'none'");
        e.sendResponseHeaders(200, bytes.length);
        try (OutputStream out = e.getResponseBody()) { out.write(bytes); }
    }

    private static void createRoom(HttpExchange e) throws IOException {
        if (!method(e, "POST")) return;
        if (!allow(roomRequests, e, 10)) { json(e, 429, "{\"error\":\"Too many rooms; retry later\"}"); return; }
        String code = null, owner = token(); RoomState room = new RoomState(owner);
        synchronized (rooms) {
            long now = System.currentTimeMillis();
            rooms.entrySet().removeIf(entry -> now - entry.getValue().createdAt > ROOM_LIFETIME);
            if (rooms.size() < MAX_ROOMS) {
                do { code = randomCode(); } while (rooms.putIfAbsent(code, room) != null);
            }
        }
        if (code == null) { json(e, 503, "{\"error\":\"Server is busy; retry later\"}"); return; }
        json(e, 200, "{\"code\":\"" + code + "\",\"ownerToken\":\"" + owner + "\"}");
    }
    private static void joinRoom(HttpExchange e) throws IOException {
        if (!method(e, "POST")) return;
        if (!allow(signalRequests, e, 600)) { json(e, 429, "{\"error\":\"Too many requests\"}"); return; }
        RoomState room = room(e);
        if (room == null) { json(e, 404, "{\"error\":\"Room not found or expired\"}"); return; }
        synchronized (room) {
            if (room.offer == null) { json(e, 404, "{\"error\":\"Room not ready\"}"); return; }
            if (room.joinToken != null) { json(e, 409, "{\"error\":\"Room already has a request\"}"); return; }
            room.joinToken = token();
            json(e, 200, "{\"joinToken\":\"" + room.joinToken + "\"}");
        }
    }
    private static void cancelRoom(HttpExchange e) throws IOException {
        if (!method(e, "POST")) return;
        if (!allow(signalRequests, e, 600)) { json(e, 429, "{\"error\":\"Too many requests\"}"); return; }
        String code = getCode(e.getRequestURI().getRawQuery()); RoomState room = code == null ? null : rooms.get(code);
        if (room == null) { json(e, 404, "{\"error\":\"Room not found\"}"); return; }
        String owner = e.getRequestHeaders().getFirst("X-Owner-Token"), joiner = e.getRequestHeaders().getFirst("X-Join-Token");
        synchronized (room) {
            if (!equalToken(room.ownerToken, owner) && !equalToken(room.joinToken, joiner)) { json(e, 403, "{\"error\":\"Invalid token\"}"); return; }
            rooms.remove(code, room);
        }
        json(e, 200, "{\"status\":\"closed\"}");
    }
    private static void signaling(HttpExchange e, boolean offer) throws IOException {
        if (!allow(signalRequests, e, 600)) { json(e, 429, "{\"error\":\"Too many requests\"}"); return; }
        RoomState room = room(e);
        if (room == null) { json(e, 410, "{\"error\":\"Room not found or expired\"}"); return; }
        if ("GET".equals(e.getRequestMethod())) {
            if (!offer && !equalToken(room.ownerToken, e.getRequestHeaders().getFirst("X-Owner-Token"))) { json(e, 403, "{\"error\":\"Invalid token\"}"); return; }
            String payload; synchronized (room) { payload = offer ? room.offer : room.answer; }
            if (payload == null) json(e, 404, "{\"error\":\"Not ready\"}"); else json(e, 200, payload);
        } else if ("POST".equals(e.getRequestMethod())) {
            String supplied = e.getRequestHeaders().getFirst(offer ? "X-Owner-Token" : "X-Join-Token");
            // Authenticate before accepting an attacker-controlled request body.
            synchronized (room) {
                if (!equalToken(offer ? room.ownerToken : room.joinToken, supplied)) { json(e, 403, "{\"error\":\"Invalid token\"}"); return; }
                if ((offer ? room.offer : room.answer) != null) { json(e, 409, "{\"error\":\"Already set\"}"); return; }
            }
            String contentLength = e.getRequestHeaders().getFirst("Content-Length");
            if (contentLength != null) {
                try { if (Long.parseLong(contentLength) > MAX_BODY) { json(e, 413, "{\"error\":\"Request too large\"}"); return; } }
                catch (NumberFormatException ex) { json(e, 400, "{\"error\":\"Invalid content length\"}"); return; }
            }
            String body;
            try { body = readBody(e); } catch (IOException ex) { json(e, 413, "{\"error\":\"Request too large\"}"); return; }
            synchronized (room) {
                if (room(e) != room) { json(e, 410, "{\"error\":\"Room not found or expired\"}"); return; }
                if (!equalToken(offer ? room.ownerToken : room.joinToken, supplied)) { json(e, 403, "{\"error\":\"Invalid token\"}"); return; }
                if ((offer ? room.offer : room.answer) != null) { json(e, 409, "{\"error\":\"Already set\"}"); return; }
                if (offer) room.offer = body; else room.answer = body;
            }
            json(e, 200, "{\"status\":\"saved\"}");
        } else { e.sendResponseHeaders(405, -1); e.close(); }
    }
    private static void iceServers(HttpExchange e) throws IOException {
        if (!method(e, "GET")) return;
        if (!allow(signalRequests, e, 600)) { json(e, 429, "{\"error\":\"Too many requests\"}"); return; }
        RoomState room = room(e);
        if (room == null) { json(e, 404, "{\"error\":\"Room not found or expired\"}"); return; }
        boolean owner = equalToken(room.ownerToken, e.getRequestHeaders().getFirst("X-Owner-Token"));
        boolean joiner; synchronized (room) { joiner = equalToken(room.joinToken, e.getRequestHeaders().getFirst("X-Join-Token")); }
        if (!owner && !joiner) { json(e, 403, "{\"error\":\"Invalid token\"}"); return; }
        synchronized (room) {
            if (owner ? ++room.ownerIce > 2 : ++room.joinIce > 2) { json(e, 429, "{\"error\":\"Credential request limit reached\"}"); return; }
        }
        if (TURN_URL.isBlank()) { json(e, 200, STUN); return; }
        try {
            URI uri = URI.create(TURN_URL);
            String host = uri.getHost();
            if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null || !host.toLowerCase(Locale.ROOT).endsWith(".metered.live") || uri.getUserInfo() != null || uri.getPort() != -1 || !"/api/v1/turn/credentials".equals(uri.getPath())) throw new IllegalArgumentException();
            HttpRequest request = HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(8)).GET().build();
            HttpResponse<String> response = HTTP.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            String body = response.body().trim();
            if (response.statusCode() != 200 || body.length() > 32000 || !body.startsWith("[") || !body.endsWith("]")) throw new IOException();
            json(e, 200, "{\"iceServers\":" + body + ",\"relay\":true}");
        } catch (Exception ex) {
            System.err.println("Free relay unavailable; using direct connections only.");
            json(e, 200, STUN);
        }
    }
    private static RoomState room(HttpExchange e) {
        String code = getCode(e.getRequestURI().getRawQuery()); RoomState r = code == null ? null : rooms.get(code);
        return r == null || System.currentTimeMillis() - r.createdAt > ROOM_LIFETIME ? null : r;
    }
    private static boolean equalToken(String expected, String actual) { return expected != null && actual != null && MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8), actual.getBytes(StandardCharsets.UTF_8)); }
    private static boolean allow(Map<String, AtomicInteger> counts, HttpExchange e, int limit) { return counts.computeIfAbsent(e.getRemoteAddress().getAddress().getHostAddress(), k -> new AtomicInteger()).incrementAndGet() <= limit; }
    private static String token() { byte[] bytes = new byte[24]; RANDOM.nextBytes(bytes); return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes); }
    private static String randomCode() { String chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; StringBuilder out = new StringBuilder(); for (int i=0; i<8; i++) out.append(chars.charAt(RANDOM.nextInt(chars.length()))); return out.toString(); }
    private static String getCode(String query) { if (query == null) return null; for (String part : query.split("&")) if (part.matches("code=[A-Z2-9]{8}")) return part.substring(5); return null; }
    private static boolean method(HttpExchange e, String expected) throws IOException { if (expected.equals(e.getRequestMethod())) return true; e.sendResponseHeaders(405, -1); e.close(); return false; }
    private static String readBody(HttpExchange e) throws IOException {
        try (InputStream in = e.getRequestBody(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] b = new byte[4096]; int n, total = 0; while ((n = in.read(b)) != -1) { total += n; if (total > MAX_BODY) throw new IOException("too large"); out.write(b, 0, n); } return out.toString(StandardCharsets.UTF_8);
        }
    }
    private static void json(HttpExchange e, int status, String body) throws IOException { e.getResponseHeaders().set("Content-Type", "application/json; charset=UTF-8"); e.getResponseHeaders().set("Cache-Control", "no-store"); send(e, status, body); }
    private static void text(HttpExchange e, int status, String body) throws IOException { e.getResponseHeaders().set("Content-Type", "text/plain; charset=UTF-8"); send(e, status, body); }
    private static void send(HttpExchange e, int status, String body) throws IOException { byte[] bytes = body.getBytes(StandardCharsets.UTF_8); e.sendResponseHeaders(status, bytes.length); try (OutputStream out = e.getResponseBody()) { out.write(bytes); } }

    private static void startTunnel() {
        Runtime.getRuntime().addShutdownHook(new Thread(() -> { Process p = tunnelProcess; if (p != null) p.destroyForcibly(); }, "stop-tunnel"));
        Thread thread = new Thread(() -> {
            while (!Thread.currentThread().isInterrupted()) {
                try {
                    Process p = new ProcessBuilder("ssh", "-R", "80:localhost:" + PORT, "-o", "ServerAliveInterval=60", "-o", "ServerAliveCountMax=3", "-o", "StrictHostKeyChecking=accept-new", "nokey@localhost.run").redirectErrorStream(true).start();
                    tunnelProcess = p;
                    try (BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream()))) {
                        String line; while ((line = r.readLine()) != null) {
                            System.out.println(line);
                            java.util.regex.Matcher m = java.util.regex.Pattern.compile("https://[A-Za-z0-9.-]+\\.(?:lhr\\.life|localhost\\.run)").matcher(line);
                            if (m.find() && !m.group().equals(tunnelUrl)) {
                                tunnelUrl = m.group(); published = false;
                                System.out.println("Tunnel connected: " + tunnelUrl);
                                if ("1".equals(System.getenv("VANILLAWARP_PUBLISH_PAGES"))) publishPages(tunnelUrl);
                            }
                        }
                    }
                    p.waitFor(); tunnelProcess = null; tunnelUrl = null; published = false; System.out.println("Tunnel disconnected. Reconnecting..."); Thread.sleep(3000);
                } catch (Exception ex) { tunnelUrl = null; published = false; System.err.println("Tunnel unavailable. Check SSH and your network."); try { Thread.sleep(5000); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); } }
            }
        }, "tunnel"); thread.setDaemon(true); thread.start();
    }
    private static void publishPages(String url) {
        Thread thread = new Thread(() -> {
            String repo = System.getenv("VANILLAWARP_GH_REPO"), ref = System.getenv("VANILLAWARP_GH_REF"), pages = System.getenv("VANILLAWARP_PAGES_URL");
            if (repo == null || ref == null || pages == null) { System.err.println("Pages settings missing. Run through run.bat."); return; }
            try {
                System.out.println("Publishing the tunnel address to GitHub Pages...");
                synchronized (PUBLISH_LOCK) {
                    if (!url.equals(tunnelUrl)) return;
                    Process process = new ProcessBuilder("gh", "workflow", "run", "pages.yml", "--repo", repo, "--ref", ref, "-f", "tunnel_url=" + url).redirectErrorStream(true).redirectOutput(ProcessBuilder.Redirect.DISCARD).start();
                    boolean finished = process.waitFor(60, TimeUnit.SECONDS);
                    if (!finished) process.destroyForcibly();
                    if (!finished || process.exitValue() != 0) { System.err.println("Pages publish failed. Check GitHub CLI sign-in, Pages settings and workflow on the default branch."); return; }
                }
                for (int i=0; i<60 && url.equals(tunnelUrl); i++) {
                    try {
                        URI config = URI.create(pages.replaceAll("/+$", "") + "/server-config.json?check=" + System.currentTimeMillis());
                        HttpResponse<String> response = HTTP.send(HttpRequest.newBuilder(config).timeout(Duration.ofSeconds(8)).GET().build(), HttpResponse.BodyHandlers.ofString());
                        if (url.equals(tunnelUrl) && response.statusCode() == 200 && response.body().contains("\"serverUrl\":\"" + url + "\"")) { published = true; System.out.println("Ready: " + pages); return; }
                    } catch (Exception ignored) {}
                    Thread.sleep(5000);
                }
                if (url.equals(tunnelUrl)) System.err.println("Pages is not ready yet. Check the Pages workflow run in GitHub.");
            } catch (Exception ex) { System.err.println("Could not start the Pages workflow. Check GitHub CLI and repository setup."); }
        }, "pages-publish"); thread.setDaemon(true); thread.start();
    }
}
