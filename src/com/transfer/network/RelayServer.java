package com.transfer.network;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.ByteBuffer;
import java.nio.channels.SelectionKey;
import java.nio.channels.Selector;
import java.nio.channels.ServerSocketChannel;
import java.nio.channels.SocketChannel;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class RelayServer implements Runnable {

    private final int port;
    private Selector selector;
    private ServerSocketChannel serverChannel;
    
    // Tracks pending sessions waiting for a receiver
    private final Map<String, SocketChannel> pendingSenderRooms = new ConcurrentHashMap<>();
    // Maps paired channels directly
    private final Map<SocketChannel, SocketChannel> activePipes = new ConcurrentHashMap<>();

    public RelayServer(int port) {
        this.port = port;
    }

    @Override
    public void run() {
        try {
            selector = Selector.open();
            serverChannel = ServerSocketChannel.open();
            serverChannel.configureBlocking(false);
            serverChannel.bind(new InetSocketAddress(port));
            serverChannel.register(selector, SelectionKey.OP_ACCEPT);

            System.out.println("[Secure Relay Engine] Active on Port " + port + "...");

            while (true) {
                selector.select();
                Iterator<SelectionKey> keys = selector.selectedKeys().iterator();

                while (keys.hasNext()) {
                    SelectionKey key = keys.next();
                    keys.remove();

                    if (!key.isValid()) continue;

                    if (key.isAcceptable()) {
                        acceptConnection(key);
                    } else if (key.isReadable()) {
                        handleStream(key);
                    }
                }
            }
        } catch (IOException e) {
            System.err.println("[Relay Error] " + e.getMessage());
        }
    }

    private void acceptConnection(SelectionKey key) throws IOException {
        ServerSocketChannel server = (ServerSocketChannel) key.channel();
        SocketChannel client = server.accept();
        client.configureBlocking(false);
        client.register(selector, SelectionKey.OP_READ);
    }

    private void handleStream(SelectionKey key) throws IOException {
        SocketChannel channel = (SocketChannel) key.channel();
        SocketChannel peer = activePipes.get(channel);

        ByteBuffer buffer = ByteBuffer.allocateDirect(2 * 1024 * 1024);
        int bytesRead = channel.read(buffer);

        if (bytesRead == -1) {
            closeSession(channel);
            return;
        }

        buffer.flip();

        // Unpaired channel initializing Room Key Handshake
        if (peer == null) {
            byte[] data = new byte[buffer.remaining()];
            buffer.get(data);
            String message = new String(data).trim();

            if (message.startsWith("JOIN_SENDER:")) {
                String roomKey = message.split(":")[1];
                if (pendingSenderRooms.containsKey(roomKey)) {
                    channel.write(ByteBuffer.wrap("ERROR:Room Key Already in Use\n".getBytes()));
                    channel.close();
                } else {
                    pendingSenderRooms.put(roomKey, channel);
                    System.out.println("[Room Created] Sender created key: " + roomKey);
                }
            } else if (message.startsWith("JOIN_RECEIVER:")) {
                String roomKey = message.split(":")[1];
                SocketChannel sender = pendingSenderRooms.remove(roomKey);

                if (sender != null && sender.isOpen()) {
                    activePipes.put(sender, channel);
                    activePipes.put(channel, sender);
                    
                    // Notify peers pairing completed
                    sender.write(ByteBuffer.wrap("CONNECTED\n".getBytes()));
                    channel.write(ByteBuffer.wrap("CONNECTED\n".getBytes()));
                    System.out.println("[Room Locked] Receiver paired with room key: " + roomKey);
                } else {
                    channel.write(ByteBuffer.wrap("ERROR:Invalid or Expired Room Key\n".getBytes()));
                    channel.close();
                }
            }
            return;
        }

        // Relay encrypted binary stream
        while (buffer.hasRemaining()) {
            peer.write(buffer);
        }
    }

    private void closeSession(SocketChannel channel) throws IOException {
        SocketChannel peer = activePipes.remove(channel);
        if (peer != null) {
            activePipes.remove(peer);
            peer.close();
        }
        channel.close();
    }
}