import { connectAccountFromAuthCode } from '../../src/modules/shared/publisher/oauth/token-service.js';

const code = 'AQKXQMNqMWcmtKUXRa6pBMLxr-sfqLZiv65aPrqhjgDEjZj_OeuyXq4AH5btuDkiH4e5NT8Uh3v_wn8kUzYkVG31SAjWtzM6vZ5tEJ9oKlXt0C2CYsWopbIUIHFi4ixIOAu6hm1rl1dhquYWG1Uc6r42KfMCCEWbAvGJcaMYWaNmD-an1FvvYvRaHSuUWKrOO_sNNv3CGneODIDsHfSOBnVtunCmhyNReixnN0BnI2sqMw';

try {
  const result = await connectAccountFromAuthCode(code);
  console.log('✅ 토큰 갱신 완료');
  console.log(`계정: ${result.handle}`);
  console.log(`만료: ${result.expiresAt.toISOString()}`);
  console.log(`신규: ${result.isNew}`);
} catch (err: any) {
  console.error('❌ 실패:', err.message);
}

import { prisma } from '../../src/db/prisma.js';
await prisma.$disconnect();
