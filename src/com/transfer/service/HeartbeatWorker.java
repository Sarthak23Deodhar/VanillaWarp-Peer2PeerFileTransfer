package com.transfer.service;

import com.transfer.network.WebSocketFrame;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.SocketChannel;

/**
 * Background thread worker sending keep-alive PING frames every 10 seconds
 * to prevent Jio/Airtel CGNAT firewalls from dropping the TCP socket connection.
 */
public class HeartbeatWorker implements Runnable {

    private final SocketChannel channel;
    private volatile boolean running = true;

    public HeartbeatWorker(SocketChannel channel) {
        this.channel = channel;
    }

    @Override
    public void run() {
        while (running && channel.isOpen()) {
            try {
                Thread.sleep(10000); // Send PING every 10 seconds
                if (channel.isConnected()) {
                    ByteBuffer pingFrame = WebSocketFrame.createPingFrame();
                    while (pingFrame.hasRemaining()) {
                        channel.write(pingFrame);
                    }
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            } catch (IOException e) {
                System.err.println("[Heartbeat] Connection closed by remote peer.");
                break;
            }
        }
    }

    public void stop() {
        this.running = false;
    }
}