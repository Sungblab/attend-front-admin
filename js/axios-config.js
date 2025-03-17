// axios 기본 설정
axios.defaults.baseURL =
  "https://port-0-attend-backend-m0tl39wtc3a73922.sel4.cloudtype.app";

// 토큰 갱신 타이머 설정
let tokenRefreshTimer;

// 토큰 자동 갱신 함수
async function setupTokenRefresh() {
  try {
    const token = localStorage.getItem("token");
    const keepLoggedIn = localStorage.getItem("keepLoggedIn") === "true";
    if (!token) return;

    // 토큰 디코딩
    const payload = JSON.parse(atob(token.split(".")[1]));
    const expiresIn = payload.exp * 1000;
    const currentTime = Date.now();

    // 만료 시간이 현재보다 이전인지 확인
    if (expiresIn <= currentTime) {
      console.log("토큰이 이미 만료되었습니다.");
      
      // 리프레시 토큰으로 갱신 시도
      const refreshToken = localStorage.getItem("refreshToken");
      if (refreshToken) {
        try {
          const response = await axios.post("/api/refresh-token", {
            refreshToken,
            keepLoggedIn,
          });
          
          if (response.data.success) {
            localStorage.setItem("token", response.data.accessToken);
            localStorage.setItem("refreshToken", response.data.refreshToken);
            localStorage.setItem("userInfo", JSON.stringify(response.data.user));
            return setupTokenRefresh(); // 새 토큰으로 타이머 재설정
          }
        } catch (error) {
          console.error("만료된 토큰 갱신 실패:", error);
          if (!keepLoggedIn) {
            localStorage.clear();
            window.location.href = "index.html?error=" + encodeURIComponent("세션이 만료되었습니다. 다시 로그인해주세요.");
            return;
          }
        }
      }
      return;
    }

    // 만료 1시간 전에 갱신
    const timeUntilRefresh = expiresIn - currentTime - 60 * 60 * 1000;

    // 이전 타이머 제거
    if (tokenRefreshTimer) clearTimeout(tokenRefreshTimer);

    // 새로운 타이머 설정
    tokenRefreshTimer = setTimeout(async () => {
      try {
        const refreshToken = localStorage.getItem("refreshToken");
        if (!refreshToken) throw new Error("리프레시 토큰이 없습니다.");

        const response = await axios.post("/api/refresh-token", {
          refreshToken,
          keepLoggedIn, // 로그인 유지 설정 전달
        });

        if (response.data.success) {
          localStorage.setItem("token", response.data.accessToken);
          localStorage.setItem("refreshToken", response.data.refreshToken);
          localStorage.setItem("userInfo", JSON.stringify(response.data.user));

          // 다음 갱신 타이머 설정
          setupTokenRefresh();
        }
      } catch (error) {
        console.error("Token refresh failed:", error);
        // 갱신 실패 시 로그인 페이지로 리다이렉트
        if (!keepLoggedIn) {
          localStorage.clear();
          window.location.href =
            "index.html?error=" +
            encodeURIComponent("세션이 만료되었습니다. 다시 로그인해주세요.");
        }
      }
    }, Math.max(1000, timeUntilRefresh)); // 최소 1초 후에 실행되도록 설정
    
    console.log(`토큰 갱신 타이머 설정됨: ${new Date(Date.now() + timeUntilRefresh)}`);
  } catch (error) {
    console.error("Error setting up token refresh:", error);
  }
}

// 페이지 로드 시 로그인 상태 체크
document.addEventListener("DOMContentLoaded", () => {
  const token = localStorage.getItem("token");
  if (!token) return;
  
  try {
    // 토큰 디코딩
    const payload = JSON.parse(atob(token.split(".")[1]));
    const expiresIn = payload.exp * 1000;
    const currentTime = Date.now();
    const keepLoggedIn = localStorage.getItem("keepLoggedIn") === "true";
    
    console.log("토큰 만료 시간:", new Date(expiresIn));
    console.log("현재 시간:", new Date(currentTime));
    console.log("로그인 유지:", keepLoggedIn);
    
    // 토큰이 유효한 경우에만 타이머 설정
    if (currentTime < expiresIn) {
      setupTokenRefresh();
    } else {
      console.log("만료된 토큰 발견, 리프레시 시도");
      // 만료된 토큰이면 리프레시 토큰으로 갱신 시도
      const refreshToken = localStorage.getItem("refreshToken");
      if (refreshToken) {
        // 비동기 즉시 실행 함수
        (async () => {
          try {
            const response = await axios.post("/api/refresh-token", {
              refreshToken,
              keepLoggedIn,
            });
            
            if (response.data.success) {
              localStorage.setItem("token", response.data.accessToken);
              localStorage.setItem("refreshToken", response.data.refreshToken);
              localStorage.setItem("userInfo", JSON.stringify(response.data.user));
              setupTokenRefresh(); // 새 토큰으로 타이머 설정
            }
          } catch (error) {
            console.error("토큰 갱신 실패:", error);
            localStorage.clear();
            window.location.href = "index.html?error=" + encodeURIComponent("세션이 만료되었습니다. 다시 로그인해주세요.");
          }
        })();
      } else {
        // 리프레시 토큰이 없으면 로그아웃
        localStorage.clear();
        window.location.href = "index.html?error=" + encodeURIComponent("세션이 만료되었습니다. 다시 로그인해주세요.");
      }
    }
  } catch (error) {
    console.error("토큰 검증 중 오류:", error);
    localStorage.clear();
    window.location.href = "index.html?error=" + encodeURIComponent("세션이 손상되었습니다. 다시 로그인해주세요.");
  }
});

axios.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

axios.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // 토큰이 만료되었고, 재시도하지 않은 요청인 경우
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const refreshToken = localStorage.getItem("refreshToken");
        if (!refreshToken) {
          throw new Error("리프레시 토큰이 없습니다.");
        }

        // 토큰 갱신 요청
        const response = await axios.post("/api/refresh-token", {
          refreshToken,
          keepLoggedIn: localStorage.getItem("keepLoggedIn") === "true"
        });

        if (!response.data.success) {
          throw new Error(response.data.message);
        }

        // 새로운 토큰 저장
        localStorage.setItem("token", response.data.accessToken);
        localStorage.setItem("refreshToken", response.data.refreshToken);
        localStorage.setItem("userInfo", JSON.stringify(response.data.user));

        // 원래 요청 헤더 업데이트
        originalRequest.headers.Authorization = `Bearer ${response.data.accessToken}`;

        // 토큰 갱신 성공 후 타이머 재설정
        setupTokenRefresh();
        
        // 원래 요청 재시도
        return axios(originalRequest);
      } catch (error) {
        console.error("Token refresh failed:", error);
        localStorage.clear();
        window.location.href =
          "index.html?error=" +
          encodeURIComponent("세션이 만료되었습니다. 다시 로그인해주세요.");
        return Promise.reject(error);
      }
    }
    return Promise.reject(error);
  }
);
