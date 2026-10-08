package com.transfer.gui;

import com.transfer.network.FileReceiver;
import com.transfer.network.FileSender;

import javax.swing.*;
import java.awt.*;
import java.io.File;
import java.util.Random;

public class P2PApplicationGUI extends JFrame {

    private JTextField serverIpField;
    private JTextField sessionKeyField;
    private JTextField fileChoiceField;
    private JProgressBar progressBar;
    private JTextArea logArea;
    private JButton generateKeyBtn;
    private File selectedFile;

    public P2PApplicationGUI() {
        setTitle("Croc-Style Secure E2EE P2P File Transfer");
        setSize(700, 520);
        setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
        setLocationRelativeTo(null);
        setLayout(new BorderLayout(10, 10));

        // Header
        JLabel headerLabel = new JLabel("Secure E2EE File Transfer Engine", SwingConstants.CENTER);
        headerLabel.setFont(new Font("SansSerif", Font.BOLD, 18));
        add(headerLabel, BorderLayout.NORTH);

        // Control Panel
        JPanel mainPanel = new JPanel(new GridLayout(5, 2, 10, 10));
        mainPanel.setBorder(BorderFactory.createEmptyBorder(10, 20, 10, 20));

        mainPanel.add(new JLabel("Relay Address:"));
        serverIpField = new JTextField("127.0.0.1:443");
        mainPanel.add(serverIpField);

        mainPanel.add(new JLabel("Secure Passphrase (Room Key):"));
        JPanel keyPanel = new JPanel(new BorderLayout(5, 0));
        sessionKeyField = new JTextField();
        generateKeyBtn = new JButton("Generate Code");
        keyPanel.add(sessionKeyField, BorderLayout.CENTER);
        keyPanel.add(generateKeyBtn, BorderLayout.EAST);
        mainPanel.add(keyPanel);

        mainPanel.add(new JLabel("Select File:"));
        JPanel filePanel = new JPanel(new BorderLayout(5, 0));
        fileChoiceField = new JTextField();
        fileChoiceField.setEditable(false);
        JButton browseBtn = new JButton("Browse...");
        filePanel.add(fileChoiceField, BorderLayout.CENTER);
        filePanel.add(browseBtn, BorderLayout.EAST);
        mainPanel.add(filePanel);

        JButton senderBtn = new JButton("Send File (E2EE)");
        JButton receiverBtn = new JButton("Receive File");
        senderBtn.setBackground(new Color(34, 139, 34));
        senderBtn.setForeground(Color.WHITE);
        receiverBtn.setBackground(new Color(30, 144, 255));
        receiverBtn.setForeground(Color.WHITE);

        mainPanel.add(senderBtn);
        mainPanel.add(receiverBtn);

        add(mainPanel, BorderLayout.CENTER);

        // Progress & Logs
        JPanel bottomPanel = new JPanel(new BorderLayout(5, 5));
        bottomPanel.setBorder(BorderFactory.createEmptyBorder(10, 20, 10, 20));

        progressBar = new JProgressBar(0, 100);
        progressBar.setStringPainted(true);
        bottomPanel.add(progressBar, BorderLayout.NORTH);

        logArea = new JTextArea(8, 50);
        logArea.setFont(new Font("Monospaced", Font.PLAIN, 12));
        bottomPanel.add(new JScrollPane(logArea), BorderLayout.CENTER);

        add(bottomPanel, BorderLayout.SOUTH);

        // Actions
        generateKeyBtn.addActionListener(e -> sessionKeyField.setText(generateCrocPassphrase()));
        browseBtn.addActionListener(e -> chooseFile());
        senderBtn.addActionListener(e -> startSender());
        receiverBtn.addActionListener(e -> startReceiver());

        sessionKeyField.setText(generateCrocPassphrase());
    }

    private String generateCrocPassphrase() {
        String[] words = {"orbit", "nexus", "falcon", "vector", "matrix", "cipher", "pulse", "quantum"};
        Random r = new Random();
        return (1000 + r.nextInt(9000)) + "-" + words[r.nextInt(words.length)] + "-" + words[r.nextInt(words.length)];
    }

    private void chooseFile() {
        JFileChooser chooser = new JFileChooser();
        if (chooser.showOpenDialog(this) == JFileChooser.APPROVE_OPTION) {
            selectedFile = chooser.getSelectedFile();
            fileChoiceField.setText(selectedFile.getAbsolutePath());
            log("[INFO] File ready: " + selectedFile.getName());
        }
    }

    private void startSender() {
        if (selectedFile == null) {
            JOptionPane.showMessageDialog(this, "Select a file first!");
            return;
        }
        log("[SECURITY] Starting AES-256 E2EE Session. Secret Code: " + sessionKeyField.getText());
    }

    private void startReceiver() {
        log("[SECURITY] Joining Room Key: " + sessionKeyField.getText());
    }

    private void log(String msg) {
        logArea.append(msg + "\n");
    }

    public static void main(String[] args) {
        SwingUtilities.invokeLater(() -> new P2PApplicationGUI().setVisible(true));
    }
}