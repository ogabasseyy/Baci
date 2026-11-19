import { Redirect } from 'expo-router';
import { OxygenVisualQaRoute } from '../components/oxygen-preview/visual-qa-route';

export default function OxygenVisualQaScreen() {
  return OxygenVisualQaRoute ? <OxygenVisualQaRoute /> : <Redirect href="/" />;
}
