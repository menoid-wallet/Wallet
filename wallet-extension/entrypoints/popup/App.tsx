
export default function App() {
  return (
    <div className="w-[360px] h-[600px] bg-black text-white overflow-hidden relative">
      
      {/* Background Glow */}
      <div className="absolute top-[-100px] left-[-100px] w-[300px] h-[300px] bg-white/10 blur-3xl rounded-full" />
      <div className="absolute bottom-[-120px] right-[-120px] w-[300px] h-[300px] bg-white/5 blur-3xl rounded-full" />

      {/* Main Content */}
      <div className="relative z-10 flex flex-col items-center justify-center h-full px-6 text-center">
        
        {/* Ghost Icon */}
        <div className="w-24 h-24 rounded-full bg-white/10 backdrop-blur-xl border border-white/10 flex items-center justify-center shadow-2xl mb-8">
          <span className="text-5xl">👻</span>
        </div>

        {/* Title */}
        <h1 className="text-5xl font-bold tracking-tight mb-3">
          Welcome to
        </h1>

        <h2 className="text-5xl font-bold bg-gradient-to-r from-white to-gray-500 bg-clip-text text-transparent mb-6">
          Menoid
        </h2>

        {/* Subtitle */}
        <p className="text-gray-400 text-sm leading-relaxed max-w-[280px] mb-10">
          Private interactions. Invisible execution.
          The future of intelligent crypto wallets.
        </p>

      </div>
    </div>
  );
}



