import Studio from './studio';
import { requireOwner } from './auth';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export default async function Page() {
  await requireOwner();
  return <Studio />;
}
