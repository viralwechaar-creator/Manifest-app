import "@/styles/globals.css";

export const metadata = {
  title: "Manifest — The Secret System",
  description: "A real-life AI coach based on the method in The Secret."
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
