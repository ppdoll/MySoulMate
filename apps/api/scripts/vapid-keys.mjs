// 웹 푸시 VAPID 키쌍을 만든다.
//
//   pnpm --filter @mysoulmate/api vapid:keys
//
// 한 번 만들면 바꾸지 않는다. 키를 바꾸면 **기존 구독이 전부 무효가 된다** —
// 사용자가 알림 권한을 다시 허용해야 하고, 그 사이 알림은 조용히 실패한다.
// 그래서 만든 값을 바로 Vercel 환경변수에 넣고 어디 적어둔다.
import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();

console.log('아래 세 값을 apps/api 의 환경변수에 넣으세요 (Vercel + 로컬 .env).');
console.log('');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('VAPID_SUBJECT=mailto:여기에-연락받을-이메일');
console.log('');
console.log('PUBLIC 키는 브라우저에도 나가는 값이라 비밀이 아닙니다.');
console.log('PRIVATE 키가 새면 우리 이름으로 알림을 보낼 수 있게 되니 절대 공개하지 마세요.');
console.log('');
console.log('한 번 정하면 바꾸지 마세요. 바꾸면 기존 구독이 전부 무효가 됩니다.');
