// 백그라운드에서 토큰 갱신을 위한 서비스 워커
const REFRESH_INTERVAL = 7 * 24 * 60 * 60 * 1000; // 7일(1주일)마다 갱신 (기존 4시간에서 변경)
const MAX_RETRY_COUNT = 3; // 최대 재시도 횟수
const RETRY_INTERVAL = 2 * 60 * 60 * 1000; // 재시도 간격 (2시간)
let refreshTokenInterval = null;
let retryCount = 0;

// 서비스 워커 설치 이벤트
self.addEventListener("install", (event) => {
  console.log("토큰 관리 서비스 워커가 설치되었습니다.");
  self.skipWaiting();
});

// 서비스 워커 활성화 이벤트
self.addEventListener("activate", (event) => {
  console.log("토큰 관리 서비스 워커가 활성화되었습니다.");
  event.waitUntil(self.clients.claim());
});

// 메시지 수신 이벤트
self.addEventListener("message", (event) => {
  console.log("서비스 워커 메시지 수신:", event.data.type);

  if (event.data && event.data.type === "START_TOKEN_REFRESH") {
    startTokenRefresh();
  } else if (event.data && event.data.type === "STOP_TOKEN_REFRESH") {
    if (refreshTokenInterval) {
      clearInterval(refreshTokenInterval);
      refreshTokenInterval = null;
      console.log("토큰 갱신 인터벌이 중지되었습니다.");
    }
  } else if (event.data && event.data.type === "TOKEN_REFRESHED") {
    // 클라이언트에서 토큰 갱신 완료 알림
    console.log("클라이언트에서 토큰이 갱신되었습니다.");
  }
});

// 토큰 갱신 시작 함수
function startTokenRefresh() {
  if (refreshTokenInterval) {
    clearInterval(refreshTokenInterval);
  }

  console.log(
    "정기적인 토큰 갱신 시작, 간격:",
    Math.floor(REFRESH_INTERVAL / 1000 / 60),
    "분"
  );

  // 즉시 한 번 실행
  attemptTokenRefresh();

  // 정기적으로 실행
  refreshTokenInterval = setInterval(attemptTokenRefresh, REFRESH_INTERVAL);
}

// 토큰 갱신 시도 함수
async function attemptTokenRefresh() {
  try {
    // 클라이언트 가져오기
    const clients = await self.clients.matchAll();
    if (clients.length === 0) {
      console.log("활성 클라이언트가 없습니다. 토큰 갱신을 건너뜁니다.");
      return;
    }

    retryCount = 0; // 성공적으로 요청을 시작하면 재시도 카운트 초기화
    // 첫 번째 클라이언트에게 토큰 갱신 요청
    clients[0].postMessage({
      type: "REFRESH_TOKEN_REQUEST",
    });

    console.log(
      "클라이언트에 토큰 갱신 요청을 보냈습니다.",
      new Date().toLocaleTimeString()
    );
  } catch (error) {
    console.error("토큰 갱신 요청 중 오류:", error);
    // 에러 발생 시 재시도 로직
    if (retryCount < MAX_RETRY_COUNT) {
      retryCount++;
      console.log(
        `토큰 갱신 실패, ${retryCount}번째 재시도 예정 (${
          RETRY_INTERVAL / 60000
        }분 후)`
      );
      setTimeout(attemptTokenRefresh, RETRY_INTERVAL);
    }
  }
}

// fetch 이벤트 - 필요하다면 여기서 인증 헤더를 추가할 수 있음
self.addEventListener("fetch", (event) => {
  // 기본 동작 유지
});
