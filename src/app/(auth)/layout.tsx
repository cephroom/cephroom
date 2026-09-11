export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-6xl items-center justify-center px-5 py-14">
      {children}
    </main>
  );
}
