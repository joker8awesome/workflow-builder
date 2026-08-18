--
-- PostgreSQL database dump
--

\restrict 4qRohJ0diQcaEJOr0R263jetaypqZEw9SbxOcIxrmycAc7gEmokOTvmr3U4oCnc

-- Dumped from database version 17.10 (Debian 17.10-0+deb13u1)
-- Dumped by pg_dump version 17.10 (Debian 17.10-0+deb13u1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: agent_cards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_cards (
    id text NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    capabilities text DEFAULT '[]'::text,
    tools text DEFAULT '[]'::text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_checkpoints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_checkpoints (
    id integer NOT NULL,
    session_id text NOT NULL,
    wf_id text DEFAULT ''::text NOT NULL,
    node_id text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_checkpoints_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agent_checkpoints_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agent_checkpoints_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agent_checkpoints_id_seq OWNED BY public.agent_checkpoints.id;


--
-- Name: agent_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_credentials (
    agent_id text NOT NULL,
    api_key text DEFAULT ''::text NOT NULL,
    scopes text DEFAULT '[]'::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    encrypted boolean DEFAULT false,
    key_hash text DEFAULT ''::text,
    revoked_at timestamp with time zone,
    expires_at timestamp with time zone,
    name text DEFAULT 'default'::text,
    key_prefix text DEFAULT ''::text,
    last_used_at timestamp with time zone,
    id integer NOT NULL
);


--
-- Name: agent_credentials_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agent_credentials_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agent_credentials_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agent_credentials_id_seq OWNED BY public.agent_credentials.id;


--
-- Name: agent_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_messages (
    id integer NOT NULL,
    msg_type text DEFAULT 'command'::text NOT NULL,
    from_agent text DEFAULT ''::text NOT NULL,
    to_agent text DEFAULT ''::text NOT NULL,
    session_id text DEFAULT ''::text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'sent'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    read_at timestamp with time zone,
    trace_id text DEFAULT ''::text,
    parent_id text DEFAULT ''::text,
    payload_ref text DEFAULT ''::text,
    task_status text DEFAULT 'completed'::text
);


--
-- Name: agent_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agent_messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agent_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agent_messages_id_seq OWNED BY public.agent_messages.id;


--
-- Name: agent_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_sessions (
    id text NOT NULL,
    agent_id text DEFAULT ''::text NOT NULL,
    node_id text DEFAULT ''::text NOT NULL,
    wf_id text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'idle'::text NOT NULL,
    workspace text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_spans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_spans (
    id integer NOT NULL,
    trace_id text DEFAULT ''::text NOT NULL,
    parent_id text DEFAULT ''::text NOT NULL,
    session_id text DEFAULT ''::text NOT NULL,
    node_id text DEFAULT ''::text NOT NULL,
    agent_id text DEFAULT ''::text NOT NULL,
    operation text DEFAULT ''::text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    duration_ms integer DEFAULT 0 NOT NULL,
    result jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: agent_spans_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agent_spans_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agent_spans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agent_spans_id_seq OWNED BY public.agent_spans.id;


--
-- Name: agents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agents (
    id text NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    person text DEFAULT ''::text NOT NULL,
    role text DEFAULT ''::text NOT NULL,
    machine jsonb DEFAULT '{}'::jsonb NOT NULL,
    color text DEFAULT '#00ff87'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    owner text DEFAULT ''::text
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id integer NOT NULL,
    actor text DEFAULT ''::text NOT NULL,
    agent_id text DEFAULT ''::text NOT NULL,
    resource text DEFAULT ''::text NOT NULL,
    action text DEFAULT ''::text NOT NULL,
    detail text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_logs_id_seq OWNED BY public.audit_logs.id;


--
-- Name: games; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.games (
    game_id text NOT NULL,
    league text NOT NULL,
    game_date date NOT NULL,
    start_time timestamp with time zone,
    home_team text NOT NULL,
    away_team text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: odds_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.odds_snapshots (
    id bigint NOT NULL,
    game_id text NOT NULL,
    provider text NOT NULL,
    bookmaker text,
    market text NOT NULL,
    side text NOT NULL,
    line numeric(6,2),
    price numeric(8,3),
    collected_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: latest_odds; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.latest_odds AS
 SELECT DISTINCT ON (game_id, market, side) game_id,
    market,
    side,
    line,
    price,
    collected_at
   FROM public.odds_snapshots
  ORDER BY game_id, market, side, collected_at DESC;


--
-- Name: llm_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.llm_cache (
    id integer NOT NULL,
    prompt_hash text DEFAULT ''::text NOT NULL,
    prompt text DEFAULT ''::text NOT NULL,
    response text DEFAULT ''::text NOT NULL,
    model text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: llm_cache_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.llm_cache_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: llm_cache_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.llm_cache_id_seq OWNED BY public.llm_cache.id;


--
-- Name: odds_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.odds_snapshots_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: odds_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.odds_snapshots_id_seq OWNED BY public.odds_snapshots.id;


--
-- Name: wf_approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wf_approvals (
    id integer NOT NULL,
    wf_id text NOT NULL,
    node_id text DEFAULT ''::text NOT NULL,
    agent_id text DEFAULT ''::text NOT NULL,
    approver text DEFAULT ''::text NOT NULL,
    decision text DEFAULT 'pending'::text NOT NULL,
    checklist text DEFAULT '{}'::text,
    context text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone,
    auto_approved boolean DEFAULT false
);


--
-- Name: wf_approvals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wf_approvals_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: wf_approvals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wf_approvals_id_seq OWNED BY public.wf_approvals.id;


--
-- Name: wf_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wf_comments (
    id integer NOT NULL,
    wf_id text NOT NULL,
    node_id text DEFAULT ''::text NOT NULL,
    author text DEFAULT '익명'::text NOT NULL,
    text text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: wf_comments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wf_comments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: wf_comments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wf_comments_id_seq OWNED BY public.wf_comments.id;


--
-- Name: wf_knowledge; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wf_knowledge (
    id integer NOT NULL,
    agent_id text DEFAULT ''::text NOT NULL,
    wf_id text DEFAULT ''::text NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    tags text DEFAULT '[]'::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: wf_knowledge_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wf_knowledge_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: wf_knowledge_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wf_knowledge_id_seq OWNED BY public.wf_knowledge.id;


--
-- Name: wf_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wf_results (
    id integer NOT NULL,
    wf_id text NOT NULL,
    node_id text DEFAULT ''::text NOT NULL,
    result jsonb DEFAULT '{}'::jsonb NOT NULL,
    run_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: wf_results_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wf_results_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: wf_results_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wf_results_id_seq OWNED BY public.wf_results.id;


--
-- Name: wf_runlogs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wf_runlogs (
    id integer NOT NULL,
    wf_id text NOT NULL,
    run_path text DEFAULT ''::text NOT NULL,
    run_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'success'::text
);


--
-- Name: wf_runlogs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wf_runlogs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: wf_runlogs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wf_runlogs_id_seq OWNED BY public.wf_runlogs.id;


--
-- Name: wf_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wf_templates (
    id text NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    category text DEFAULT ''::text NOT NULL,
    tags text DEFAULT '[]'::text,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    installs integer DEFAULT 0 NOT NULL,
    rating real DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: wf_tests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wf_tests (
    id integer NOT NULL,
    wf_id text DEFAULT ''::text NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    input jsonb DEFAULT '{}'::jsonb NOT NULL,
    expected jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_status text DEFAULT 'pending'::text NOT NULL,
    last_run_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: wf_tests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wf_tests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: wf_tests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wf_tests_id_seq OWNED BY public.wf_tests.id;


--
-- Name: wf_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wf_versions (
    id integer NOT NULL,
    wf_id text NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: wf_versions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wf_versions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: wf_versions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wf_versions_id_seq OWNED BY public.wf_versions.id;


--
-- Name: wf_workflows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wf_workflows (
    id text NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    schedule text DEFAULT ''::text,
    trigger_type text DEFAULT 'manual'::text,
    owner text DEFAULT ''::text
);


--
-- Name: agent_checkpoints id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_checkpoints ALTER COLUMN id SET DEFAULT nextval('public.agent_checkpoints_id_seq'::regclass);


--
-- Name: agent_credentials id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_credentials ALTER COLUMN id SET DEFAULT nextval('public.agent_credentials_id_seq'::regclass);


--
-- Name: agent_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_messages ALTER COLUMN id SET DEFAULT nextval('public.agent_messages_id_seq'::regclass);


--
-- Name: agent_spans id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_spans ALTER COLUMN id SET DEFAULT nextval('public.agent_spans_id_seq'::regclass);


--
-- Name: audit_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs ALTER COLUMN id SET DEFAULT nextval('public.audit_logs_id_seq'::regclass);


--
-- Name: llm_cache id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_cache ALTER COLUMN id SET DEFAULT nextval('public.llm_cache_id_seq'::regclass);


--
-- Name: odds_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.odds_snapshots ALTER COLUMN id SET DEFAULT nextval('public.odds_snapshots_id_seq'::regclass);


--
-- Name: wf_approvals id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wf_approvals ALTER COLUMN id SET DEFAULT nextval('public.wf_approvals_id_seq'::regclass);


--
-- Name: wf_comments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wf_comments ALTER COLUMN id SET DEFAULT nextval('public.wf_comments_id_seq'::regclass);


--
-- Name: wf_knowledge id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wf_knowledge ALTER COLUMN id SET DEFAULT nextval('public.wf_knowledge_id_seq'::regclass);


--
-- Name: wf_results id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wf_results ALTER COLUMN id SET DEFAULT nextval('public.wf_results_id_seq'::regclass);


--
-- Name: wf_runlogs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wf_runlogs ALTER COLUMN id SET DEFAULT nextval('public.wf_runlogs_id_seq'::regclass);


--
-- Name: wf_tests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wf_tests ALTER COLUMN id SET DEFAULT nextval('public.wf_tests_id_seq'::regclass);


--
-- Name: wf_versions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wf_versions ALTER COLUMN id SET DEFAULT nextval('public.wf_versions_id_seq'::regclass);


--
-- Name: agent_cards agent_cards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_cards
    ADD CONSTRAINT agent_cards_pkey PRIMARY KEY (id);


--
-- Name: agent_checkpoints agent_checkpoints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_checkpoints
    ADD CONSTRAINT agent_checkpoints_pkey PRIMARY KEY (id);


--
-- Name: agent_credentials agent_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_credentials
    ADD CONSTRAINT agent_credentials_pkey PRIMARY KEY (id);


--
-- Name: agent_messages agent_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_messages
    ADD CONSTRAINT agent_messages_pkey PRIMARY KEY (id);


--
-- Name: agent_sessions agent_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_sessions
    ADD CONSTRAINT agent_sessions_pkey PRIMARY KEY (id);


--
-- Name: agent_spans agent_spans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_spans
    ADD CONSTRAINT agent_spans_pkey PRIMARY KEY (id);


--
-- Name: agents agents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: games games_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.games
    ADD CONSTRAINT games_pkey PRIMARY KEY (game_id);


--
-- Name: llm_cache llm_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_cache
    ADD CONSTRAINT llm_cache_pkey PRIMARY KEY (id);


--
-- Name: odds_snapshots odds_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.odds_snapshots
    ADD CONSTRAINT odds_snapshots_pkey PRIMARY KEY (id);


--
-- Name: wf_approvals wf_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wf_approvals
    ADD CONSTRAINT wf_approvals_pkey PRIMARY KEY (id);


--
-- Name: wf_comments wf_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wf_comments
    ADD CONSTRAINT wf_comments_pkey PRIMARY KEY (id);


--
-- Name: wf_knowledge wf_knowledge_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wf_knowledge
    ADD CONSTRAINT wf_knowledge_pkey PRIMARY KEY (id);


--
-- Name: wf_results wf_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wf_results
    ADD CONSTRAINT wf_results_pkey PRIMARY KEY (id);


--
-- Name: wf_runlogs wf_runlogs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wf_runlogs
    ADD CONSTRAINT wf_runlogs_pkey PRIMARY KEY (id);


--
-- Name: wf_templates wf_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wf_templates
    ADD CONSTRAINT wf_templates_pkey PRIMARY KEY (id);


--
-- Name: wf_tests wf_tests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wf_tests
    ADD CONSTRAINT wf_tests_pkey PRIMARY KEY (id);


--
-- Name: wf_versions wf_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wf_versions
    ADD CONSTRAINT wf_versions_pkey PRIMARY KEY (id);


--
-- Name: wf_workflows wf_workflows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wf_workflows
    ADD CONSTRAINT wf_workflows_pkey PRIMARY KEY (id);


--
-- Name: idx_agent_credentials_agent_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_credentials_agent_id ON public.agent_credentials USING btree (agent_id) WHERE (revoked_at IS NULL);


--
-- Name: idx_agent_credentials_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_agent_credentials_id ON public.agent_credentials USING btree (id);


--
-- Name: idx_agent_credentials_key_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_agent_credentials_key_hash ON public.agent_credentials USING btree (key_hash) WHERE ((revoked_at IS NULL) AND (key_hash IS NOT NULL) AND (key_hash <> ''::text));


--
-- Name: idx_odds_game_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_odds_game_time ON public.odds_snapshots USING btree (game_id, collected_at);


--
-- Name: idx_odds_market; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_odds_market ON public.odds_snapshots USING btree (market, side);


--
-- Name: odds_snapshots odds_snapshots_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.odds_snapshots
    ADD CONSTRAINT odds_snapshots_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(game_id) ON DELETE CASCADE;


--
-- Name: wf_comments wf_comments_wf_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wf_comments
    ADD CONSTRAINT wf_comments_wf_id_fkey FOREIGN KEY (wf_id) REFERENCES public.wf_workflows(id) ON DELETE CASCADE;


--
-- Name: wf_results wf_results_wf_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wf_results
    ADD CONSTRAINT wf_results_wf_id_fkey FOREIGN KEY (wf_id) REFERENCES public.wf_workflows(id) ON DELETE CASCADE;


--
-- Name: wf_runlogs wf_runlogs_wf_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wf_runlogs
    ADD CONSTRAINT wf_runlogs_wf_id_fkey FOREIGN KEY (wf_id) REFERENCES public.wf_workflows(id) ON DELETE CASCADE;


--
-- Name: wf_versions wf_versions_wf_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wf_versions
    ADD CONSTRAINT wf_versions_wf_id_fkey FOREIGN KEY (wf_id) REFERENCES public.wf_workflows(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict 4qRohJ0diQcaEJOr0R263jetaypqZEw9SbxOcIxrmycAc7gEmokOTvmr3U4oCnc


-- ===== fb_* (formula-backtracer Phase 0) — 야구 픽 games/odds_snapshots 와 별개 =====
-- 지시서 #49/#50. MLB 라벨 + SGO 배당 스냅샷.

CREATE TABLE IF NOT EXISTS fb_games (
  game_pk    bigint PRIMARY KEY,        -- MLB Stats API gamePk
  game_date  date NOT NULL,
  start_time timestamptz,
  home_team  text NOT NULL,
  away_team  text NOT NULL,
  home_score int,                        -- Final 시 채움
  away_score int,
  status     text,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fb_odds_snapshots (
  id           bigserial PRIMARY KEY,
  game_pk      bigint REFERENCES fb_games(game_pk),
  sgo_event_id text,
  game_date    date,
  home_team    text, away_team text,
  bookmaker    text,
  market       text,
  side         text,
  price        numeric,
  collected_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fb_odds_game_time ON fb_odds_snapshots (game_pk, collected_at);
CREATE INDEX IF NOT EXISTS idx_fb_odds_event ON fb_odds_snapshots (sgo_event_id, collected_at);

-- 지시서 #54. 무료 과거배당(SBR GitHub 데이터셋) — 마감 moneyline 단일값.
CREATE TABLE IF NOT EXISTS fb_odds_hist (
  id          bigserial PRIMARY KEY,
  game_pk     bigint REFERENCES fb_games(game_pk),  -- 조인 후 채움(NULL 허용)
  game_date   date, home_team text, away_team text, -- 데이터셋 원문(조인용)
  ml_home     numeric, ml_away numeric,             -- moneyline currentLine(decimal 평균)
  source      text DEFAULT 'sbr-github',
  ingested_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fb_odds_hist_game ON fb_odds_hist (game_pk);

