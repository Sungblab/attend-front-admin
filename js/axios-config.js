// axios 기본 설정
axios.defaults.baseURL =
  "https://port-0-attend-backend-m0tl39wtc3a73922.sel4.cloudtype.app";

// 중복 요청 방지를 위한 변수
let isRefreshing = false;
let tokenRefreshTimer;
let lastRefreshTime = 0;
const MIN_REFRESH_INTERVAL = 60 * 1000; // 1분

// 토큰 갱신 함수
async function refreshToken() {
  if (isRefreshing) return;
  isRefreshing = true;
  
  try {
    const refreshToken = localStorage.getItem("refreshToken");
    if (!refreshToken) throw new Error();
    
    const response = await axios.post("/api/refresh-token", {
      refreshToken,
      keepLoggedIn: true
    });
    
    localStorage.setItem("token", response.data.accessToken);
    localStorage.setItem("refreshToken", response.data.refreshToken);
    localStorage.setItem("userInfo", JSON.stringify(response.data.user));
    
    lastRefreshTime = Date.now();
    console.log("토큰 갱신 성공:", new Date().toLocaleTimeString());
  } catch (error) {
    console.error("토큰 갱신 실패");
    localStorage.clear();
    window.location.href = "index.html?error=" + encodeURIComponent("세션이 만료되었습니다. 다시 로그인해주세요.");
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
      await refreshToken();
      
      // 토큰 갱신 후 원래 요청 재시도
      const newToken = localStorage.getItem("token");
      if (newToken) {
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return axios(originalRequest);
      }
    }
    
    return Promise.reject(error);
  }
);

// 토큰 유효성 확인
document.addEventListener("DOMContentLoaded", () => {
  const token = localStorage.getItem("token");
  if (!token) return;
  
  try {
    // 토큰 디코딩
    const payload = JSON.parse(atob(token.split(".")[1]));
    const expiresIn = payload.exp * 1000;
    const currentTime = Date.now();
    
    // 만료 시간 확인
    if (currentTime >= expiresIn) {
      console.log("토큰이 만료됨, 갱신 시도");
      refreshToken();
    } else {
      // 만료 30분 전에 갱신 타이머 설정
      const timeUntilRefresh = Math.max(1000, expiresIn - currentTime - 30 * 60 * 1000);
      if (tokenRefreshTimer) clearTimeout(tokenRefreshTimer);
      tokenRefreshTimer = setTimeout(refreshToken, timeUntilRefresh);
      console.log(`토큰 갱신 예정: ${new Date(Date.now() + timeUntilRefresh).toLocaleTimeString()}`);
    }
  } catch (error) {
    console.error("토큰 검증 실패");
    localStorage.clear();
    window.location.href = "index.html?error=" + encodeURIComponent("세션이 손상되었습니다. 다시 로그인해주세요.");
  }
});
