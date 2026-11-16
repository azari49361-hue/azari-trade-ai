import React from 'react';

/** پس‌زمینه ملایم و کم‌نور (جایگزین پس‌زمینه پرنور) */
export const SpectralBackground: React.FC = () => {
  return (
    <div className="spectral-bg spectral-bg-calm" aria-hidden="true">
      <div className="spectral-calm-gradient" />
    </div>
  );
};
