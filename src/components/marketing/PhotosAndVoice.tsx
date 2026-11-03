import { useEffect, useState } from 'react';
import BusinessExtras from './BusinessExtras';
import { api, type WorkspaceData } from './shared';

/** The photos Pilot may use and the voice it writes in. They sit on the Business information page with everything else about the business. */
export default function PhotosAndVoice() {
  const [data, setData] = useState<WorkspaceData | null>(null);
  useEffect(() => { let alive = true; void api<WorkspaceData>('/api/marketing/workspace').then((result) => { if (alive && result.ok) setData(result.data); }); return () => { alive = false; }; }, []);
  return data ? <BusinessExtras data={data} /> : null;
}
