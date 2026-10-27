// 录制核心在 @amoolink/scrcpy-client/mp4 子路径(Node/渲染共用,含 avcC 构造与校验);
// 不能从包根引:会把 scrcpy-session 的 node:events 拉进浏览器导致白屏。
export { H264Mp4Recorder, annexBToLengthPrefixed } from '@amoolink/scrcpy-client/mp4'
