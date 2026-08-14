#!/usr/bin/env python3
"""
워크플로우 빌더 에이전트 SDK — 외부 AI 에이전트가 WS 브릿지에 붙는 클라이언트

사용:
  from agent_sdk import AgentClient
  client = AgentClient(agent_id="ag_xxx", api_key="ag_yyy", ws_url="ws://localhost:3737/ws/agent")
  client.on_command(handler)   # 명령 수신 핸들러 등록
  client.run_forever()

웹 UI에서 ▶실행 → orchestrator가 DB에 명령 기록 → WS 브릿지가 즉시 전달
이 SDK는 명령을 받아 처리하고 workflow_report(MCP)로 결과 보고.
"""
import json
import time
import threading
import urllib.request

try:
    import websocket  # websocket-client
    HAS_WS = True
except ImportError:
    HAS_WS = False


class AgentClient:
    def __init__(self, agent_id, api_key, ws_url="ws://localhost:3737/ws/agent", server="http://localhost:3737"):
        self.agent_id = agent_id
        self.api_key = api_key
        self.ws_url = f"{ws_url}?agent_id={agent_id}&key={api_key}"
        self.server = server
        self.handlers = []
        self._ws = None
        self._running = False

    def on_command(self, handler):
        """명령 수신 핸들러: handler(msg_dict)"""
        self.handlers.append(handler)

    def _on_message(self, msg):
        try:
            data = json.loads(msg)
        except Exception:
            return
        if data.get("type") == "connected":
            print(f"[sdk] 연결됨: {self.agent_id}")
            return
        if data.get("type") in ("command", "instruction"):
            for h in self.handlers:
                try:
                    h(data)
                except Exception as e:
                    print(f"[sdk] handler 오류: {e}")

    def report(self, trace_id, status, summary="", result_ref=""):
        """결과 보고 — MCP workflow_report와 동일한 효과 (REST 폴백)"""
        try:
            req = urllib.request.Request(
                self.server + "/api/agent/report",
                data=json.dumps({
                    "agent_id": self.agent_id, "trace_id": trace_id,
                    "status": status, "summary": summary, "result_ref": result_ref
                }).encode(),
                headers={"Content-Type": "application/json"}
            )
            urllib.request.urlopen(req, timeout=10)
            return True
        except Exception as e:
            print(f"[sdk] 보고 실패: {e}")
            return False

    def run_forever(self, retry_delay=3):
        """WS 접속 유지 — 끊기면 재접속"""
        if not HAS_WS:
            print("[sdk] websocket-client 필요: pip install websocket-client")
            return
        self._running = True
        while self._running:
            try:
                self._ws = websocket.create_connection(self.ws_url, timeout=30)
                while self._running:
                    msg = self._ws.recv()
                    if msg:
                        self._on_message(msg)
            except Exception as e:
                print(f"[sdk] 연결 끊김 ({e}) — {retry_delay}s 후 재접속")
                time.sleep(retry_delay)


def main():
    """CLI 데모: --agent ag_xxx --key ag_yyy"""
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--agent", required=True)
    ap.add_argument("--key", required=True)
    ap.add_argument("--ws", default="ws://localhost:3737/ws/agent")
    args = ap.parse_args()
    client = AgentClient(args.agent, args.key, ws_url=args.ws)

    @client.on_command
    def handle(msg):
        print(f"[명령 수신] {msg.get('type')} from={msg.get('from_agent')} trace={msg.get('trace_id')} ref={msg.get('payload_ref')}")
        client.report(msg.get("trace_id", ""), "completed", summary="SDK 데모 처리 완료")

    client.run_forever()


if __name__ == "__main__":
    main()
