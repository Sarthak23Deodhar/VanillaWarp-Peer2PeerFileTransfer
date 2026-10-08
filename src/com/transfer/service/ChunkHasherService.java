package com.transfer.service;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.List;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

public class ChunkHasherService {

    /**
     * Computes the SHA-256 hash string for a raw binary buffer payload.
     */
    public static String computeHash(byte[] payload) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hashBytes = digest.digest(payload);
            
            // Java 8 Stream to convert byte array to Hex String
            return IntStream.range(0, hashBytes.length)
                    .mapToObj(i -> String.format("%02x", hashBytes[i]))
                    .collect(Collectors.joining());
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException("SHA-256 algorithm not available", e);
        }
    }

    /**
     * Java 8 Functional Interface method to verify chunk hash integrity.
     */
    public static boolean verifyChunk(byte[] payload, String expectedHash) {
        String actualHash = computeHash(payload);
        return actualHash.equalsIgnoreCase(expectedHash);
    }
}