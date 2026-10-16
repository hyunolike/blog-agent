/**
 * 글 번호 → 프로젝트 설명.
 * 글에는 "DND", "동아리" 같은 소속이 GitHub 주소에만 있거나 아예 없어서 "동아리 프로젝트 보여줘" 같은 질문에 걸리지 않는다.
 * 여기 적은 설명은 그 글의 모든 조각 맨 앞에 `프로젝트: …` 한 줄로 붙고, 바꾸면 다음 수집 때 해당 글만 다시 임베딩된다.
 */
const MOYEORAK = "모여락 (DND 14기 IT 동아리에서 시작한 프로젝트, 모임 장소 추천 서비스)";
const OGUOGU = "오구오구 (DDD IT 동아리 프로젝트, 감정 해소형 익명 커뮤니티)";

export const PROJECTS: Record<number, string> = {
  36: MOYEORAK,
  37: MOYEORAK,
  38: MOYEORAK,
  41: MOYEORAK,
  44: MOYEORAK,
  58: MOYEORAK,
  60: MOYEORAK,
  61: MOYEORAK,
  66: MOYEORAK,
  54: OGUOGU,
};
