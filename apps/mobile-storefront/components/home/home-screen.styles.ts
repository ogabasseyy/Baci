import { StyleSheet } from 'react-native';

export const homeScreenStyles = StyleSheet.create({
  headerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  eliteBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 0,
  },
  contentContainer: {
    flexGrow: 1,
  },
  blockWrapper: {
    alignSelf: 'stretch',
    width: '100%',
  },
});
