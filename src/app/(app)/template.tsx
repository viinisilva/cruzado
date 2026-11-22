// Re-mounts on every navigation inside the app, so each page enters with the same short fade and rise (see .page-in).
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-in">{children}</div>;
}
