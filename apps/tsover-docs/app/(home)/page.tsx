'use client';

import { useEffect } from 'react';

const TARGET = 'https://tsover.swmansion.com';

export default function HomePage() {
  useEffect(() => {
    window.location.replace(TARGET);
  }, []);

  return (
    <div className="flex items-center justify-center min-h-[50vh] text-fg/70">
      <meta name="robots" content="noindex, nofollow" />
      <link rel="canonical" href={TARGET} />
      <p>
        Redirecting to{' '}
        <a href={TARGET} className="text-fg underline">
          {TARGET}
        </a>
        …
      </p>
    </div>
  );
}
