import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ErrorState } from './components/common';
import { Layout } from './components/Layout';
import { AuthProvider } from './lib/auth';
import { AiPage } from './pages/AiPage';
import { HomePage, RulesPage } from './pages/HomePage';
import { JoinPage } from './pages/JoinPage';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { LoginPage } from './pages/LoginPage';
import { OnlinePage } from './pages/OnlinePage';
import { ProfilePage } from './pages/ProfilePage';
import { RankedPage } from './pages/RankedPage';
import { ReplayPage } from './pages/ReplayPage';
import { RoomPage } from './pages/RoomPage';
import './styles/global.css';
import './styles/board.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="ai" element={<AiPage />} />
            <Route path="online" element={<OnlinePage />} />
            <Route path="ranked" element={<RankedPage />} />
            <Route path="room/:roomId" element={<RoomPage />} />
            <Route path="join/:token" element={<JoinPage />} />
            <Route path="leaderboard" element={<LeaderboardPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="profile/:uid" element={<ProfilePage />} />
            <Route path="replay/:matchId" element={<ReplayPage />} />
            <Route path="login" element={<LoginPage />} />
            <Route path="rules" element={<RulesPage />} />
            <Route path="*" element={<ErrorState title="Không tìm thấy trang" />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>,
);
