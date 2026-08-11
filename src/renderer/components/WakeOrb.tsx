import React from 'react';

export type OrbPhase = 'idle' | 'listening' | 'speaking';

interface WakeOrbProps {
  phase: OrbPhase;
  onClick?: () => void;
  size?: number; // Size in pixels (e.g. 120)
}

export const WakeOrb: React.FC<WakeOrbProps> = ({ phase, onClick, size = 120 }) => {
  return (
    <div
      onClick={onClick}
      style={{ width: `${size}px`, height: `${size}px` }}
      className="drag-region flex items-center justify-center cursor-pointer select-none relative group bg-transparent overflow-hidden rounded-full"
      title="Click to open Saira"
    >
      {/* Outer ambient glow */}
      <div
        className={`absolute rounded-full transition-all duration-500 blur-lg opacity-70 ${
          phase === 'listening'
            ? 'w-24 h-24 bg-blue-500/80 animate-pulse scale-110'
            : phase === 'speaking'
            ? 'w-24 h-24 bg-emerald-400/80 animate-pulse scale-105'
            : 'w-20 h-20 bg-indigo-500/40 animate-pulse'
        }`}
      />

      {/* Main Glass Orb Core */}
      <div
        className={`no-drag relative w-20 h-20 rounded-full flex items-center justify-center shadow-xl backdrop-blur-xl border border-white/20 transition-all duration-300 group-hover:scale-105 ${
          phase === 'listening'
            ? 'bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 shadow-blue-500/50'
            : phase === 'speaking'
            ? 'bg-gradient-to-tr from-emerald-600 via-teal-600 to-cyan-600 shadow-teal-500/50'
            : 'bg-gradient-to-tr from-slate-900 via-slate-800 to-indigo-950 shadow-indigo-900/40'
        }`}
      >
        {/* Simplified Indicators: listening, speaking, idle */}
        {phase === 'listening' ? (
          <div className="flex items-center space-x-1.5 h-6">
            <div className="w-1.5 bg-white rounded-full animate-[bounce_0.6s_infinite_100ms] h-5" />
            <div className="w-1.5 bg-cyan-300 rounded-full animate-[bounce_0.6s_infinite_300ms] h-7" />
            <div className="w-1.5 bg-white rounded-full animate-[bounce_0.6s_infinite_200ms] h-4" />
            <div className="w-1.5 bg-blue-300 rounded-full animate-[bounce_0.6s_infinite_400ms] h-6" />
          </div>
        ) : phase === 'speaking' ? (
          <div className="flex items-center space-x-1 h-5">
            <div className="w-1.5 bg-emerald-200 rounded-full animate-[pulse_0.4s_infinite_100ms] h-4" />
            <div className="w-1.5 bg-white rounded-full animate-[pulse_0.4s_infinite_200ms] h-6" />
            <div className="w-1.5 bg-cyan-200 rounded-full animate-[pulse_0.4s_infinite_300ms] h-5" />
          </div>
        ) : (
          <div className="relative flex items-center justify-center">
            <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-emerald-400 via-cyan-400 to-blue-500 opacity-90 blur-[1px] animate-pulse" />
            <span className="absolute text-xs text-white/90 font-bold">S</span>
          </div>
        )}
      </div>
    </div>
  );
};
