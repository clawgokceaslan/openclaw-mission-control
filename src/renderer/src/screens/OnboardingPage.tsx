import { Link } from 'react-router-dom'
import styles from './OnboardingPage.module.scss'
import { APP_ROUTES } from '@shared/constants/ui-routes'

export function OnboardingPage() {
  return (
    <section className={styles.page}>
      <h1 className={styles.title}>Onboarding</h1>
      <p>Kurulum doğrulama sayfası. Aşağıdaki adımları tamamlayın:</p>
      <ol>
        <li>
          <Link to={APP_ROUTES.INVITE}>Kullanıcı davet et</Link>
        </li>
        <li>
          <Link to={APP_ROUTES.GATEWAYS}>Gateway durumunu doğrula</Link>
        </li>
        <li>
          <Link to={APP_ROUTES.PROJECTS}>Project ve task akışını doğrula</Link>
        </li>
      </ol>
    </section>
  )
}
