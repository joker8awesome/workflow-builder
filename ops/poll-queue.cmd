@echo off
REM poll-queue.cmd — Windows 작업 스케줄러용 래퍼
REM
REM 스케줄러에서 인자·경로 인용부호 문제를 피하려고 .cmd 로 감쌌다.
REM 동작을 바꾸려면 아래 MODE 만 수정하면 된다.
REM
REM   --run   대기 건이 있으면 claude 세션을 띄워 처리를 맡긴다 (자율 실행)
REM   (빈값)  확인만 하고 로그에 남긴다 (자율 실행 없음)

set MODE=--run

REM 로그에 한글이 깨지지 않도록 UTF-8 코드페이지 사용
chcp 65001 >nul
set PYTHONIOENCODING=utf-8

cd /d "%~dp0.."
node "ops\poll-queue.js" %MODE% >> "ops\poll-queue.log" 2>&1
exit /b 0
