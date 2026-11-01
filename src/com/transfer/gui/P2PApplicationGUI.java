package com.transfer.gui;

import javax.swing.*;
import java.awt.*;
import java.net.URI;

/** Desktop entry point for the same WebRTC client used by browser peers. */
public class P2PApplicationGUI extends JFrame {
    private static final long serialVersionUID = 1L;
    private final JTextField url = new JTextField("http://localhost:8080/", 30);

    public P2PApplicationGUI() {
        super("VanillaWarp");
        setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
        JPanel panel = new JPanel(new BorderLayout(8, 8));
        panel.setBorder(BorderFactory.createEmptyBorder(16, 16, 16, 16));
        panel.add(new JLabel("Server URL (start the VanillaWarp server first):"), BorderLayout.NORTH);
        panel.add(url, BorderLayout.CENTER);
        JButton open = new JButton("Open VanillaWarp in browser");
        open.addActionListener(e -> openBrowser());
        panel.add(open, BorderLayout.SOUTH);
        add(panel);
        pack();
        setLocationRelativeTo(null);
    }

    private void openBrowser() {
        try {
            URI uri = URI.create(url.getText().trim());
            if (!("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme())) || uri.getHost() == null) {
                throw new IllegalArgumentException("Enter a valid HTTP or HTTPS server URL.");
            }
            if (!Desktop.isDesktopSupported() || !Desktop.getDesktop().isSupported(Desktop.Action.BROWSE)) {
                throw new IllegalStateException("Cannot open a browser automatically. Open the URL manually.");
            }
            Desktop.getDesktop().browse(uri);
        } catch (Exception e) {
            JOptionPane.showMessageDialog(this, e.getMessage(), "Unable to open browser", JOptionPane.ERROR_MESSAGE);
        }
    }

    public static void main(String[] args) {
        SwingUtilities.invokeLater(() -> new P2PApplicationGUI().setVisible(true));
    }
}
