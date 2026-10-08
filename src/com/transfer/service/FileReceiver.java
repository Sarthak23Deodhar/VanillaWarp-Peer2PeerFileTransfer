package com.transfer.network;

import com.transfer.service.HeartbeatWorker;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.ByteBuffer;
import java.nio.channels.SocketChannel;

public class FileReceiver implements Runnable {

    private final String host;
    private final int port;
    private final File saveDestination;
    private final String sessionKey;

    public FileReceiver(String host, int port, File saveDestination, String sessionKey) {
        this.host = host;
        this.port = port;
        this.saveDestination = saveDestination;
        this.sessionKey = sessionKey;
    }

    @Override
    public void run() {
        try (SocketChannel socketChannel = SocketChannel.open()) {
            socketChannel.connect(new InetSocketAddress(host, port));
            socketChannel.configureBlocking(true);

            // Start background Heartbeat worker
            HeartbeatWorker heartbeat = new HeartbeatWorker(socketChannel);
            new Thread(heartbeat).start();

            // Send Receiver Session Header
            ByteBuffer header = ByteBuffer.wrap(("RECEIVER:" + sessionKey + "\n").getBytes());
            socketChannel.write(header);

            try (FileOutputStream fos = new FileOutputStream(saveDestination)) {
                ByteBuffer buffer = ByteBuffer.allocateDirect(2 * 1024 * 1024); // 2 MB Buffer
                byte[] fileBuffer = new byte[2 * 1024 * 1024];

                while (socketChannel.read(buffer) > 0) {
                    buffer.flip();
                    int length = buffer.remaining();
                    buffer.get(fileBuffer, 0, length);
                    
                    fos.write(fileBuffer, 0, length);
                    buffer.clear();
                }
            }

            heartbeat.stop();
            System.out.println("[FileReceiver] File transfer finished. Saved to: " + saveDestination.getAbsolutePath());

        } catch (IOException e) {
            System.err.println("[FileReceiver Error] Receive failed: " + e.getMessage());
        }
    }
}