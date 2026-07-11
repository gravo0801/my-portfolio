function authApi() {
  if (typeof window === "undefined" || !window.firebaseAuth) {
    throw new Error("Firebase Auth is not initialized");
  }
  return window.firebaseAuth;
}

export function getAuthProfile(user) {
  const current = user || (typeof window !== "undefined" ? window.firebaseAuth?.currentUser?.() : null);
  if (!current) return null;

  const providers = (current.providerData || [])
    .map((provider) => provider?.providerId)
    .filter(Boolean);

  return {
    uid: current.uid || "",
    isAnonymous: Boolean(current.isAnonymous),
    email: current.email || "",
    displayName: current.displayName || "",
    photoURL: current.photoURL || "",
    providers,
    googleLinked: providers.includes("google.com"),
  };
}

function googleProvider() {
  const api = authApi();
  if (!api.createGoogleProvider) {
    throw new Error("Google authentication is not available");
  }
  return api.createGoogleProvider();
}

export async function signInWithGoogle() {
  const api = authApi();
  const result = await api.signInWithPopup(googleProvider());
  return getAuthProfile(result?.user || api.currentUser?.());
}

export async function linkCurrentUserWithGoogle() {
  const api = authApi();
  const current = api.currentUser?.();
  if (!current) throw new Error("로그인된 Firebase 사용자가 없습니다.");

  const existing = getAuthProfile(current);
  if (existing?.googleLinked) return existing;

  const result = await api.linkWithPopup(current, googleProvider());
  return getAuthProfile(result?.user || api.currentUser?.());
}

export function authErrorMessage(error) {
  const code = String(error?.code || "");
  if (code === "auth/operation-not-allowed") {
    return "Firebase Console에서 Google 로그인 제공자를 먼저 활성화해야 합니다.";
  }
  if (code === "auth/popup-blocked") {
    return "브라우저가 Google 로그인 팝업을 차단했습니다. 팝업 허용 후 다시 시도해주세요.";
  }
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
    return "Google 계정 연결이 취소되었습니다.";
  }
  if (code === "auth/credential-already-in-use" || code === "auth/account-exists-with-different-credential") {
    return "이 Google 계정은 다른 Firebase 사용자와 이미 연결되어 있습니다. 현재 데이터 보호를 위해 자동 전환하지 않았습니다.";
  }
  return error?.message || "Google 인증 처리 중 오류가 발생했습니다.";
}
