import "./style.css";

function IndexPopup() {
  return (
    <div className="w-[360px] h-[600px] bg-black text-white relative overflow-hidden">
      
      {/* Glow Effects */}
      <div className="absolute top-[-120px] left-[-120px] w-[250px] h-[250px] bg-white/10 blur-3xl rounded-full" />
      <div className="absolute bottom-[-120px] right-[-120px] w-[250px] h-[250px] bg-white/5 blur-3xl rounded-full" />

      <div className="relative z-10 flex flex-col items-center justify-center h-full px-6 text-center">
        
        <div className="w-24 h-24 rounded-full bg-white/10 border border-white/10 backdrop-blur-xl flex items-center justify-center mb-8 shadow-2xl">
          <span className="text-5xl">👻</span>
        </div>

        <h1 className="text-5xl font-bold mb-2">
          Welcome to
        </h1>

        <h2 className="text-5xl font-bold bg-gradient-to-r from-white to-gray-500 bg-clip-text text-transparent mb-6">
          Menoid
        </h2>

        <p className="text-gray-400 text-sm leading-relaxed max-w-[280px] mb-10">
          AI-native private smart wallet for Monad.
        </p>
      </div>
    </div>
  )
}

export default IndexPopup

