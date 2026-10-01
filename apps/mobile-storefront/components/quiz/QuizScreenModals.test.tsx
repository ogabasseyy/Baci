import { jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { QuizScreenModals } from './QuizScreenModals';

jest.mock('./QuizUsernameGateModal', () => ({
  QuizUsernameGateModal: ({ visible }: { visible: boolean }) => {
    if (!visible) return null;
    const React = jest.requireActual('react') as typeof import('react');
    const { Text } = jest.requireActual(
      'react-native'
    ) as typeof import('react-native');
    return React.createElement(Text, null, 'username modal');
  },
}));
jest.mock('./QuizDateOfBirthGateModal', () => ({
  QuizDateOfBirthGateModal: ({ visible }: { visible: boolean }) => {
    if (!visible) return null;
    const React = jest.requireActual('react') as typeof import('react');
    const { Text } = jest.requireActual(
      'react-native'
    ) as typeof import('react-native');
    return React.createElement(Text, null, 'date of birth modal');
  },
}));

describe('QuizScreenModals', () => {
  it('renders both profile gates when their start flow requests them', () => {
    render(
      <QuizScreenModals
        dobGate={{
          cancelGate: jest.fn(),
          confirmGate: jest.fn(),
          correctionError: null,
          dateOfBirth: null,
          generation: 1,
          isGateVisible: true,
        }}
        usernameGate={{
          cancelGate: jest.fn(),
          confirmGate: jest.fn(),
          isGateVisible: true,
        }}
      />
    );

    expect(screen.getByText('username modal')).toBeTruthy();
    expect(screen.getByText('date of birth modal')).toBeTruthy();
  });
});
