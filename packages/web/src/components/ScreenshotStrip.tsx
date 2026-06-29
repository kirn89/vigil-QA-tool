'use client';
import { useRef, useState } from 'react';

export function ScreenshotStrip({ shots }: { shots: string[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [active, setActive] = useState<string | null>(null);
  if (shots.length === 0) return null;
  const open = (src: string) => { setActive(src); dialogRef.current?.showModal(); };
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {shots.map((src, i) => (
        <button key={i} type="button" onClick={() => open(src)} className="rounded-lg border border-line">
          <img src={src} alt={`step screenshot ${i + 1}`} className="h-32 rounded-lg" />
        </button>
      ))}
      <dialog ref={dialogRef} onClick={() => dialogRef.current?.close()} className="rounded-lg p-0 backdrop:bg-black/50">
        {active && <img src={active} alt="screenshot enlarged" className="max-h-[80vh] max-w-[80vw]" />}
      </dialog>
    </div>
  );
}
