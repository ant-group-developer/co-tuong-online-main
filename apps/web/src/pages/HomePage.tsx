import { START_FEN, positionFromFen } from '@xq/engine';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Board } from '../components/Board';
import { useAppName } from '../components/Layout';

export function HomePage() {
  const { t } = useTranslation();
  const appName = useAppName();
  const board = useMemo(() => positionFromFen(START_FEN).board, []);
  return (
    <div className="home">
      <section className="hero">
        <div className="hero-text">
          <img src="/logo.png" alt="" width={72} height={72} className="hero-logo" />
          <h1>{appName}</h1>
          <div className="hero-actions">
            <Link to="/ai" className="btn primary big" data-testid="home-ai">
              {t('home.playAi')}
            </Link>
            <Link to="/ranked" className="btn big">
              {t('home.playRanked')}
            </Link>
            <Link to="/online" className="btn big">
              {t('home.playFriends')}
            </Link>
          </div>
        </div>
        <div className="hero-board" aria-hidden="true">
          <Board board={board} disabled ariaLabel={t('board.demo')} />
        </div>
      </section>
    </div>
  );
}

export function RulesPage() {
  const { t } = useTranslation();
  return (
    <div className="page narrow prose">
      <h1>{t('rules.title')}</h1>
      <h2>{t('rules.rulesTitle')}</h2>
      <p>{t('rules.intro')}</p>
      <ul>
        <li>{t('rules.r1')}</li>
        <li>{t('rules.r2')}</li>
        <li>{t('rules.r3')}</li>
        <li>{t('rules.r4')}</li>
      </ul>
      <h2>{t('rules.onlineTitle')}</h2>
      <ul>
        <li>{t('rules.o1')}</li>
        <li>{t('rules.o2')}</li>
        <li>{t('rules.o3')}</li>
        <li>{t('rules.o4')}</li>
        <li>{t('rules.o5')}</li>
      </ul>
    </div>
  );
}
