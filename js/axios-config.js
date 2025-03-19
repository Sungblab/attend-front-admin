// axios 기본 설정
axios.defaults.baseURL =
  "https://port-0-attend-backend-m0tl39wtc3a73922.sel4.cloudtype.app";

// 중복 요청 방지를 위한 변수
let isRefreshing = false;
let tokenRefreshTimer;
let lastRefreshTime = parseInt(localStorage.getItem("lastRefreshTime") || "0");
const MIN_REFRESH_INTERVAL = 60 * 60 * 1000; // 1시간 (기존 1분에서 변경)
const TOKEN_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24시간마다 토큰 체크 (기존 10분에서 변경)

// 쿠키 관련 유틸리티 함수
function setCookie(name, value, days) {
  const date = new Date();
  date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
  const expires = "; expires=" + date.toUTCString();
  document.cookie = name + "=" + value + expires + "; path=/; SameSite=Strict";
}

function getCookie(name) {
  const value = "; " + document.cookie;
  const parts = value.split("; " + name + "=");
  if (parts.length === 2) return parts.pop().split(";").shift();
  return null;
}

function deleteCookie(name) {
  document.cookie = name + "=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
}

// 토큰 저장 통합 함수
function storeTokens(accessToken, refreshToken, userInfo, keepLoggedIn) {
  // 로컬 스토리지에 저장
  localStorage.setItem("token", accessToken);
  localStorage.setItem("refreshToken", refreshToken);
  localStorage.setItem("userInfo", JSON.stringify(userInfo));
  localStorage.setItem("lastRefreshTime", Date.now().toString());
  localStorage.setItem("lastActive", Date.now().toString());

  // 리프레시 토큰을 쿠키에도 저장 (백업용) - 항상 1년으로 설정
  setCookie("refresh_token", refreshToken, 365);
}

// 토큰 갱신 함수
async function refreshToken() {
  if (isRefreshing) return false;
  isRefreshing = true;

  try {
    // 로컬 스토리지에서 리프레시 토큰 확인
    let refreshToken = localStorage.getItem("refreshToken");

    // 로컬 스토리지에 없으면 쿠키에서 확인 (백업)
    if (!refreshToken) {
      refreshToken = getCookie("refresh_token");
      if (!refreshToken) {
        throw new Error("리프레시 토큰이 없습니다");
      }
      // 쿠키에서 찾은 토큰으로 스토리지 복원
      localStorage.setItem("refreshToken", refreshToken);
    }

    console.log("토큰 갱신 시도:", new Date().toLocaleTimeString());
    const keepLoggedIn = localStorage.getItem("keepLoggedIn") === "true";

    const response = await axios.post("/api/refresh-token", {
      refreshToken,
      keepLoggedIn,
    });

    // 새 토큰 저장
    const { accessToken, refreshToken: newRefreshToken, user } = response.data;
    storeTokens(accessToken, newRefreshToken, user, keepLoggedIn);

    lastRefreshTime = Date.now();
    localStorage.setItem("lastRefreshTime", lastRefreshTime.toString());
    console.log("토큰 갱신 성공:", new Date().toLocaleTimeString());

    // 서비스 워커에게 토큰 갱신 알림 (있는 경우)
    if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: "TOKEN_REFRESHED",
        token: accessToken,
        refreshToken: newRefreshToken,
      });
    }

    return true;
  } catch (error) {
    console.error("토큰 갱신 실패:", error);

    // 로그인 유지 설정 저장
    const keepLoggedIn = localStorage.getItem("keepLoggedIn");

    // 쿠키와 localStorage 초기화 (keepLoggedIn 제외)
    deleteCookie("refresh_token");

    // localStorage 항목을 개별적으로 삭제하여 keepLoggedIn 값 보존
    localStorage.removeItem("token");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("userInfo");
    localStorage.removeItem("lastRefreshTime");
    localStorage.removeItem("lastActive");

    // keepLoggedIn 값 다시 저장
    if (keepLoggedIn) {
      localStorage.setItem("keepLoggedIn", keepLoggedIn);
    }

    window.location.href =
      "index.html?error=" +
      encodeURIComponent("세션이 만료되었습니다. 다시 로그인해주세요.");
    return false;
  } finally {
    isRefreshing = false;
  }
}

// 인증 헤더 추가
axios.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// 401 에러 처리 및 토큰 자동 갱신
axios.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // 401 에러이고 재시도한 적이 없는 경우에만 처리
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      // 마지막 갱신 이후 일정 시간이 지났는지 확인
      if (Date.now() - lastRefreshTime < MIN_REFRESH_INTERVAL) {
        console.log("토큰 갱신 요청이 너무 빈번함, 현재 토큰으로 재시도");
        const currentToken = localStorage.getItem("token");
        if (currentToken) {
          originalRequest.headers.Authorization = `Bearer ${currentToken}`;
          return axios(originalRequest);
        }
      }

      // 토큰 갱신 시도
      const refreshSuccess = await refreshToken();

      // 토큰 갱신 후 원래 요청 재시도
      if (refreshSuccess) {
        const newToken = localStorage.getItem("token");
        if (newToken) {
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
          return axios(originalRequest);
        }
      }
    }

    return Promise.reject(error);
  }
);

// 토큰 유효성 확인 함수
function checkTokenValidity(forceRefresh = false) {
  const token = localStorage.getItem("token");
  const keepLoggedIn = localStorage.getItem("keepLoggedIn") === "true";

  // 토큰이 없는 경우
  if (!token) {
    // 쿠키에 리프레시 토큰이 있는지 확인
    const cookieRefreshToken = getCookie("refresh_token");
    if (cookieRefreshToken) {
      console.log("쿠키에서 리프레시 토큰 발견, 복구 시도");
      localStorage.setItem("refreshToken", cookieRefreshToken);
      // keepLoggedIn 값이 없으면 기본적으로 true로 설정 (쿠키에서 복구한 경우)
      if (localStorage.getItem("keepLoggedIn") === null) {
        localStorage.setItem("keepLoggedIn", "true");
      }
      refreshToken(); // 토큰 복구 시도
      return true;
    }
    return false;
  }

  try {
    // 토큰 디코딩
    const payload = JSON.parse(atob(token.split(".")[1]));
    const expiresIn = payload.exp * 1000;
    const currentTime = Date.now();
    const timeUntilExpiry = expiresIn - currentTime;

    console.log(
      `토큰 상태 확인: 만료까지 ${Math.floor(
        timeUntilExpiry / 1000 / 60
      )}분 남음, 로그인 유지: ${keepLoggedIn}`
    );

    // 쿠키와 localStorage 간의 동기화 확인
    const localRefreshToken = localStorage.getItem("refreshToken");
    const cookieRefreshToken = getCookie("refresh_token");

    // 로컬 스토리지에는 있지만 쿠키에는 없는 경우, 쿠키에도 저장
    if (localRefreshToken && !cookieRefreshToken && keepLoggedIn) {
      console.log("리프레시 토큰을 쿠키에 동기화합니다");
      const days = keepLoggedIn ? 365 : 30;
      setCookie("refresh_token", localRefreshToken, days);
    }

    // 만료 시간 확인 (24시간 이내로 남았거나 강제 갱신 요청된 경우)
    if (
      currentTime >= expiresIn ||
      timeUntilExpiry < 24 * 60 * 60 * 1000 ||
      forceRefresh
    ) {
      console.log("토큰 갱신이 필요함, 갱신 시도");
      refreshToken();

      // 서비스 워커에 토큰 갱신 시작 요청
      if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: "START_TOKEN_REFRESH",
        });
      }
    } else {
      // 만료 48시간 전에 갱신 타이머 설정 (기존 타이머 취소 후 재설정)
      const timeUntilRefresh = Math.max(
        1000,
        expiresIn - currentTime - 48 * 60 * 60 * 1000
      );
      console.log(
        `토큰 만료 예정: ${new Date(expiresIn).toLocaleTimeString()}`
      );
      console.log(
        `토큰 갱신 예정: ${new Date(
          Date.now() + timeUntilRefresh
        ).toLocaleTimeString()}`
      );

      if (tokenRefreshTimer) clearTimeout(tokenRefreshTimer);
      tokenRefreshTimer = setTimeout(refreshToken, timeUntilRefresh);

      // 추가: 페이지가 계속 열려있을 때도 주기적으로 토큰 상태 확인
      setTimeout(() => checkTokenValidity(), TOKEN_CHECK_INTERVAL);
    }

    // 페이지 가시성 변경 감지를 위한 lastActive 시간 저장
    localStorage.setItem("lastActive", Date.now().toString());
    return true;
  } catch (error) {
    console.error("토큰 검증 실패:", error);

    // 로그인 유지 설정 저장
    const keepLoggedIn = localStorage.getItem("keepLoggedIn");

    // localStorage 항목을 개별적으로 삭제하여 keepLoggedIn 값 보존
    localStorage.removeItem("token");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("userInfo");
    localStorage.removeItem("lastRefreshTime");
    localStorage.removeItem("lastActive");

    // keepLoggedIn 값 다시 저장
    if (keepLoggedIn) {
      localStorage.setItem("keepLoggedIn", keepLoggedIn);
    }

    deleteCookie("refresh_token");
    window.location.href =
      "index.html?error=" +
      encodeURIComponent("세션이 손상되었습니다. 다시 로그인해주세요.");
    return false;
  }
}

// 서비스 워커 등록
async function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    try {
      const registration = await navigator.serviceWorker.register(
        "/js/token-service-worker.js"
      );
      console.log("서비스 워커가 등록되었습니다:", registration.scope);

      // 기존 토큰이 있으면 서비스 워커에게 알림
      const token = localStorage.getItem("token");
      const refreshToken = localStorage.getItem("refreshToken");

      if (token && refreshToken && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: "START_TOKEN_REFRESH",
          token,
          refreshToken,
        });
      }
    } catch (error) {
      console.log("서비스 워커 등록 실패:", error);
    }
  }
}

// 페이지 로드 시 토큰 유효성 검사 - 강제 갱신 플래그 추가
document.addEventListener("DOMContentLoaded", () => {
  // 서비스 워커 등록 시도
  registerServiceWorker();

  // 마지막 새로고침 시간 확인
  const lastActive = parseInt(localStorage.getItem("lastActive") || "0");
  const timeSinceLastActive = Date.now() - lastActive;

  // 1시간 이상 지났으면 강제로 토큰 갱신 시도
  const forceRefresh = timeSinceLastActive > 60 * 60 * 1000;

  if (forceRefresh) {
    console.log("장시간 비활성 상태 감지, 토큰 강제 갱신 시도");
  }

  checkTokenValidity(forceRefresh);
});

// 페이지 가시성 변경 시 토큰 확인 (브라우저 탭 전환, 최소화 후 복귀 등)
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    const lastActive = parseInt(localStorage.getItem("lastActive") || "0");
    const timeSinceLastActive = Date.now() - lastActive;

    // 마지막 활성 시간으로부터 5분 이상 지났으면 토큰 유효성 재확인
    if (timeSinceLastActive > 5 * 60 * 1000) {
      console.log(
        `페이지 복귀 감지, 비활성 시간: ${Math.floor(
          timeSinceLastActive / 1000 / 60
        )}분, 토큰 유효성 재확인`
      );
      checkTokenValidity(timeSinceLastActive > 30 * 60 * 1000); // 30분 이상 지났으면 강제 갱신
    }
  }
});

// 브라우저 탭 닫기/새로고침 시 토큰 유효성 시간 저장
window.addEventListener("beforeunload", () => {
  localStorage.setItem("lastActive", Date.now().toString());
});
