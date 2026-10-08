package com.transfer.network;

import com.transfer.service.ChunkHasherService;
import com.transfer.service.HeartbeatWorker;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.channels.SocketChannel;

public class FileSender implements Runnable {

    private final String host;
    private final int port;
    private final File fileToSend;
    private final String sessionKey;

    public FileSender(String host, int port, File fileToSend, String sessionKey) {
        this.host = host;
        this.port = port;
        this.fileToSend = fileToSend;
        this.sessionKey = sessionKey;
    }

    @Override
    public void run() {
        try (SocketChannel socketChannel = SocketChannel.open()) {
            socketChannel.connect(new InetSocketAddress(host, port));
            socketChannel.configureBlocking(true);

            // Start background Heartbeat worker for CGNAT keep-alive
            HeartbeatWorker heartbeat = new HeartbeatWorker(socketChannel);
            new Thread(heartbeat).start();

            // Send Session Identification Header
            ByteBuffer header = ByteBuffer.wrap(("SENDER:" + sessionKey + "\n").getBytes());
            socketChannel.write(header);

            // Open File Channel for high-speed reading
            try (FileInputStream fis = new FileInputStream(fileToSend);
                 FileChannel fileChannel = fis.getChannel()) {

                int chunkSize = 2 * 1024 * 1024; // 2 MB Chunks
                ByteBuffer buffer = ByteBuffer.allocateDirect(chunkSize);
                byte[] bytesContainer = new byte[chunkSize];

                while (fileChannel.read(buffer) > 0) {
                    buffer.flip();
                    int bytesToRead = buffer.remaining();
                    buffer.get(bytesContainer, 0, bytesToRead);

                    // Wrap chunk into WebSocket frame to pass mobile network DPI
                    ByteBuffer frame = WebSocketFrame.wrap(bytesContainer, WebSocketFrame.OPCODE_BINARY);
                    while (frame.hasRemaining()) {
                        socketChannel.write(frame);
                    }
                    buffer.clear();
                }
            }

            heartbeat.stop();
            System.out.println("[FileSender] File successfully transmitted.");

        } catch (IOException e) {
            System.err.println("[FileSender Error] Transfer interrupted: " + e.getMessage());
        }
    }
}