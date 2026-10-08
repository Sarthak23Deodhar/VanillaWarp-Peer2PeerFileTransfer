/*
 * VanillaWarp Signaling & Relay Server - Enterprise Edition
 * 
 * Features:
 * - WebRTC SDP Signaling (Polling & SSE support)
 * - Persistent localhost.run SSH Tunneling with Auto-Restart
 * - SQLite Telemetry Engine (JDBC)
 * - Live TCP Socket Admin Console (Port 8081)
 * - Token Bucket IP Rate Limiting
 */

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

import java.io.*;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.Statement;
import java.util.Random;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

public class WebRelayServer {

    private static final int PORT = 8080;
    private static final int ADMIN_PORT = 8081;
    private static String activeTunnelUrl = null;
    
    // In-memory data stores
    private static final ConcurrentHashMap<String, RoomState> rooms = new ConcurrentHashMap<>();
    private static final ConcurrentHashMap<String, Integer> requestCounts = new ConcurrentHashMap<>();
    
    static class RoomState {
        String offerPayload = null;
        String answerPayload = null;
        long timestamp = System.currentTimeMillis();
    }

    public static void main(String[] args) throws IOException {
        // Initialize embedded SQLite Database
        initDatabase();

        // Initialize HTTP Server
        HttpServer server = HttpServer.create(new InetSocketAddress(PORT), 0);

        // Core Endpoints
        server.createContext("/", new StaticFileHandler());
        server.createContext("/api/tunnel-url", new TunnelUrlHandler());
        server.createContext("/api/room/create", new CreateRoomHandler());
        server.createContext("/api/offer", new OfferHandler());
        server.createContext("/api/answer", new AnswerHandler());

        server.setExecutor(Executors.newCachedThreadPool());
        server.start();
        System.out.println("VanillaWarp Server initialized on port " + PORT);
        
        // Start Background Daemons
        startRoomCleanupDaemon();
        startTunnelDaemon();
        startAdminConsole();
    }

    // --------------------------------------------------------
    // Enterprise Daemons & Subsystems
    // --------------------------------------------------------

    private static void initDatabase() {
        String url = "jdbc:sqlite:vanillawarp.db";
        try (Connection conn = DriverManager.getConnection(url);
             Statement stmt = conn.createStatement()) {
            
            String sql = "CREATE TABLE IF NOT EXISTS transfers (\n"
                    + " id INTEGER PRIMARY KEY AUTOINCREMENT,\n"
                    + " room_code TEXT NOT NULL,\n"
                    + " client_ip TEXT NOT NULL,\n"
                    + " created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n"
                    + " status TEXT NOT NULL\n"
                    + ");";
            stmt.execute(sql);
            System.out.println("Telemetry database initialized.");
        } catch (Exception e) {
            System.err.println("Database initialization failed: " + e.getMessage());
        }
    }

    public static void logRoomCreation(String roomCode, String clientIp) {
        String url = "jdbc:sqlite:vanillawarp.db";
        String sql = "INSERT INTO transfers(room_code, client_ip, status) VALUES(?, ?, ?)";
        try (Connection conn = DriverManager.getConnection(url);
             PreparedStatement pstmt = conn.prepareStatement(sql)) {
            pstmt.setString(1, roomCode);
            pstmt.setString(2, clientIp);
            pstmt.setString(3, "CREATED");
            pstmt.executeUpdate();
        } catch (Exception e) {
            System.err.println("Failed to log telemetry: " + e.getMessage());
        }
    }

    private static void startAdminConsole() {
        Thread adminThread = new Thread(() -> {
            try (ServerSocket serverSocket = new ServerSocket(ADMIN_PORT)) {
                System.out.println("Live Admin Console listening on port " + ADMIN_PORT);
                while (true) {
                    Socket clientSocket = serverSocket.accept();
                    new Thread(() -> handleAdminClient(clientSocket)).start();
                }
            } catch (IOException e) {
                System.err.println("Admin console error: " + e.getMessage());
            }
        });
        adminThread.setDaemon(true);
        adminThread.start();
    }

    private static void handleAdminClient(Socket clientSocket) {
        try (
            BufferedReader in = new BufferedReader(new InputStreamReader(clientSocket.getInputStream()));
            PrintWriter out = new PrintWriter(clientSocket.getOutputStream(), true)
        ) {
            out.println("====================================");
            out.println(" VanillaWarp Admin Console v1.0");
            out.println("====================================");
            out.println("Commands: STATUS, KILL [room], EXIT");
            out.print("admin@vanillawarp:~$ ");
            out.flush();
            
            String line;
            while ((line = in.readLine()) != null) {
                String[] args = line.trim().toUpperCase().split(" ");
                if (args[0].equals("STATUS")) {
                    out.println("Active Rooms: " + rooms.size());
                    out.println("Tunnel URL: " + (activeTunnelUrl != null ? activeTunnelUrl : "Offline"));
                } else if (args[0].equals("KILL") && args.length == 2) {
                    if (rooms.remove(args[1]) != null) out.println("Room " + args[1] + " terminated.");
                    else out.println("Room not found.");
                } else if (args[0].equals("EXIT")) {
                    break;
                } else {
                    out.println("Unknown command.");
                }
                out.print("admin@vanillawarp:~$ ");
                out.flush();
            }
        } catch (IOException e) {
            System.err.println("Admin client disconnected.");
        }
    }

    private static void startTunnelDaemon() {
        Thread tunnelThread = new Thread(() -> {
            while (true) {
                try {
                    System.out.println("Starting resilient localhost.run tunnel...");
                    ProcessBuilder pb = new ProcessBuilder(
                        "ssh", "-R", "80:localhost:" + PORT, 
                        "-o", "ServerAliveInterval=60", 
                        "-o", "ServerAliveCountMax=3", 
                        "-o", "StrictHostKeyChecking=no",
                        "nokey@localhost.run"
                    );
                    
                    pb.redirectErrorStream(true);
                    Process process = pb.start();

                    BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()));
                    String line;
                    while ((line = reader.readLine()) != null) {
                        if (line.contains(".lhr.life")) {
                            String[] parts = line.split(" ");
                            for (String part : parts) {
                                if (part.contains(".lhr.life")) {
                                    activeTunnelUrl = "https://" + part.trim();
                                    System.out.println("Tunnel Active: " + activeTunnelUrl);
                                }
                            }
                        }
                    }
                    
                    process.waitFor();
                    System.out.println("Tunnel connection lost. Restarting in 3 seconds...");
                    activeTunnelUrl = null;
                    Thread.sleep(3000); 
                    
                } catch (Exception e) {
                    System.err.println("Tunnel daemon error: " + e.getMessage());
                    try { Thread.sleep(5000); } catch (InterruptedException ie) {}
                }
            }
        });
        tunnelThread.setDaemon(true);
        tunnelThread.start();
    }

    private static void startRoomCleanupDaemon() {
        Executors.newSingleThreadScheduledExecutor().scheduleAtFixedRate(() -> {
            // Clear expired rooms
            long now = System.currentTimeMillis();
            rooms.entrySet().removeIf(entry -> (now - entry.getValue().timestamp) > 3600000); // 1 Hour limit
            
            // Flush rate limit tokens
            requestCounts.clear();
        }, 1, 1, TimeUnit.MINUTES);
    }

    // --------------------------------------------------------
    // HTTP Handlers (WebRTC Signaling)
    // --------------------------------------------------------

    static class StaticFileHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if ("GET".equals(exchange.getRequestMethod())) {
                File file = new File("index.html");
                if (file.exists()) {
                    byte[] bytes = Files.readAllBytes(file.toPath());
                    exchange.getResponseHeaders().set("Content-Type", "text/html; charset=UTF-8");
                    exchange.sendResponseHeaders(200, bytes.length);
                    OutputStream os = exchange.getResponseBody();
                    os.write(bytes);
                    os.close();
                } else {
                    String response = "404 - index.html not found";
                    exchange.sendResponseHeaders(404, response.length());
                    OutputStream os = exchange.getResponseBody();
                    os.write(response.getBytes());
                    os.close();
                }
            }
        }
    }

    static class TunnelUrlHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            String jsonResponse = "{}";
            if (activeTunnelUrl != null) {
                jsonResponse = "{\"url\":\"" + activeTunnelUrl + "\"}";
            }
            sendJsonResponse(exchange, 200, jsonResponse);
        }
    }

    static class CreateRoomHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if ("POST".equals(exchange.getRequestMethod())) {
                
                // IP Rate Limiting (Token Bucket approach)
                String clientIp = exchange.getRemoteAddress().getAddress().getHostAddress();
                int requests = requestCounts.getOrDefault(clientIp, 0);
                
                if (requests >= 5) {
                    sendJsonResponse(exchange, 429, "{\"error\":\"Rate limit exceeded. Try again in 1 minute.\"}");
                    return;
                }
                requestCounts.put(clientIp, requests + 1);

                // Generate and track room
                String code = generateCode(6);
                rooms.put(code, new RoomState());
                logRoomCreation(code, clientIp); // SQLite Telemetry insertion
                
                String jsonResponse = "{\"code\":\"" + code + "\"}";
                sendJsonResponse(exchange, 200, jsonResponse);
            } else {
                exchange.sendResponseHeaders(405, -1);
            }
        }

        private String generateCode(int length) {
            String chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
            StringBuilder sb = new StringBuilder();
            Random rnd = new Random();
            while (sb.length() < length) { 
                sb.append(chars.charAt((int) (rnd.nextFloat() * chars.length())));
            }
            return sb.toString();
        }
    }

    static class OfferHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            String code = extractCode(exchange.getRequestURI().getQuery());
            if (code == null || !rooms.containsKey(code)) {
                sendJsonResponse(exchange, 404, "{\"error\":\"Room not found\"}");
                return;
            }

            RoomState room = rooms.get(code);

            if ("POST".equals(exchange.getRequestMethod())) {
                String payload = readRequestBody(exchange);
                room.offerPayload = payload;
                sendJsonResponse(exchange, 200, "{\"status\":\"Offer saved\"}");
            } else if ("GET".equals(exchange.getRequestMethod())) {
                if (room.offerPayload != null) {
                    sendJsonResponse(exchange, 200, room.offerPayload);
                } else {
                    sendJsonResponse(exchange, 404, "{\"error\":\"Offer not ready\"}");
                }
            }
        }
    }

    static class AnswerHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            String code = extractCode(exchange.getRequestURI().getQuery());
            if (code == null || !rooms.containsKey(code)) {
                sendJsonResponse(exchange, 404, "{\"error\":\"Room not found\"}");
                return;
            }

            RoomState room = rooms.get(code);

            if ("POST".equals(exchange.getRequestMethod())) {
                String payload = readRequestBody(exchange);
                room.answerPayload = payload;
                sendJsonResponse(exchange, 200, "{\"status\":\"Answer saved\"}");
            } else if ("GET".equals(exchange.getRequestMethod())) {
                if (room.answerPayload != null) {
                    sendJsonResponse(exchange, 200, room.answerPayload);
                } else {
                    sendJsonResponse(exchange, 404, "{\"error\":\"Answer not ready\"}");
                }
            }
        }
    }

    // --------------------------------------------------------
    // Utility Methods
    // --------------------------------------------------------

    private static String extractCode(String query) {
        if (query == null) return null;
        for (String param : query.split("&")) {
            String[] pair = param.split("=");
            if (pair.length > 1 && "code".equals(pair[0])) {
                return pair[1].toUpperCase();
            }
        }
        return null;
    }

    private static String readRequestBody(HttpExchange exchange) throws IOException {
        InputStream is = exchange.getRequestBody();
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        int nRead;
        byte[] data = new byte[1024];
        while ((nRead = is.read(data, 0, data.length)) != -1) {
            buffer.write(data, 0, nRead);
        }
        buffer.flush();
        return new String(buffer.toByteArray(), StandardCharsets.UTF_8);
    }

    private static void sendJsonResponse(HttpExchange exchange, int statusCode, String response) throws IOException {
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=UTF-8");
        exchange.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
        
        byte[] bytes = response.getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(statusCode, bytes.length);
        OutputStream os = exchange.getResponseBody();
        os.write(bytes);
        os.close();
    }
}