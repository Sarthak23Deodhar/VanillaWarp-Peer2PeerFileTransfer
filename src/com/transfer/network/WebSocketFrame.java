package com.transfer.network;

import java.nio.ByteBuffer;

/**
 * Encapsulates raw binary file data in lightweight WebSocket binary frames (Opcode 0x2)
 * or Ping frames (Opcode 0x9) to pass through CGNAT and Deep Packet Inspection (DPI).
 */
public class WebSocketFrame {

    public static final byte OPCODE_BINARY = 0x2;
    public static final byte OPCODE_PING = 0x9;
    public static final byte OPCODE_PONG = 0xA;

    /**
     * Wraps raw payload bytes into a standard unmasked WebSocket binary frame.
     */
    public static ByteBuffer wrap(byte[] payload, byte opcode) {
        int length = payload.length;
        int headerSize = 2;

        if (length > 125 && length <= 65535) {
            headerSize += 2; // 16-bit extended payload length
        } else if (length > 65535) {
            headerSize += 8; // 64-bit extended payload length
        }

        ByteBuffer frame = ByteBuffer.allocateDirect(headerSize + length);

        // FIN bit set (0x80) + Opcode
        frame.put((byte) (0x80 | (opcode & 0x0F)));

        // Payload length encoding (Unmasked server frame)
        if (length <= 125) {
            frame.put((byte) length);
        } else if (length <= 65535) {
            frame.put((byte) 126);
            frame.putShort((short) length);
        } else {
            frame.put((byte) 127);
            frame.putLong(length);
        }

        frame.put(payload);
        frame.flip();
        return frame;
    }

    /**
     * Creates a 2-byte Keep-Alive Ping frame.
     */
    public static ByteBuffer createPingFrame() {
        return wrap(new byte[]{}, OPCODE_PING);
    }
}