'use client';
import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

interface DropdownOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: DropdownOption[];
  className?: string;
}

export function Dropdown({ value, onChange, options, className }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div ref={ref} className={`relative ${className || ''}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 bg-ink-850 border border-white/10 rounded-sm text-[11px] font-mono text-ink-50 hover:border-white/30 transition-colors w-full"
      >
        <span className="truncate flex-1 text-left">{selected?.label || value}</span>
        <ChevronDown size={12} className={`text-ink-500 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[180px] max-h-64 overflow-y-auto bg-ink-900 border border-white/10 rounded-sm shadow-2xl">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-[11px] font-mono transition-colors ${
                opt.value === value
                  ? 'bg-white/10 text-ink-50'
                  : 'text-ink-300 hover:bg-white/5 hover:text-ink-50'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
