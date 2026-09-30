import { useAuth0 } from '@auth0/auth0-react';

// Simple pre-login screen shown by App.tsx whenever the user isn't authenticated (isAuthenticated is false).
// It has no props — clicking "Sign in" just kicks off the Auth0 hosted-login redirect flow set up in main.tsx.
export default function LoginPage() {
  const { loginWithRedirect } = useAuth0();

  return (
    <div className="min-h-screen bg-[#F5F2ED] flex items-center justify-center p-8">
      <div className="flex flex-col items-center gap-8 w-full max-w-sm">

        {/* Logo */}
        <div className="text-center">
          <h1 className="text-5xl font-serif font-light tracking-tight text-[#1A1A1A] mb-2">
            Vino<span className="italic font-medium">Druid</span>
          </h1>
          <p className="text-xs uppercase tracking-widest text-black/40 font-bold">
            Wine Data Onboarding
          </p>
        </div>

        {/* Card */}
        <div className="w-full bg-white rounded-2xl border border-black/5 shadow-sm p-8 flex flex-col items-center gap-6">
          <p className="text-sm text-black/50 text-center leading-relaxed">
            Sign in to manage and validate your wine data imports.
          </p>
          <button
            onClick={() => loginWithRedirect()}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-[#1A1A1A] text-white text-sm font-medium rounded-xl hover:bg-black/80 transition-colors"
          >
            Sign in
          </button>
        </div>

      </div>
    </div>
  );
}
