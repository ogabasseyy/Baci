import Ionicons from '@react-native-vector-icons/ionicons';
import * as ImagePicker from 'expo-image-picker';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { z } from 'zod';
import { InvalidRouteScreen } from '@/components/ui/InvalidRouteScreen';
import SafeImage from '@/components/ui/SafeImage';
import { RADIUS, SPACING, TYPOGRAPHY } from '@/constants/theme';
import { useMerchant } from '@/hooks/useMerchant';
import { useTheme } from '@/hooks/useTheme';
import { supabase } from '@/lib/supabase';
import { uploadBlogImage } from '@/lib/upload/uploadBlogImage';

// Route param validation - accepts UUID or 'new' for creating new posts
const routeParamsSchema = z.object({
  id: z.union([z.literal('new'), z.uuid()]),
});

type BlogPostStatus = 'draft' | 'published' | 'archived';

interface PersistBlogPostInput {
  category: string;
  excerpt: string;
  featuredImage: string;
  id: string | undefined;
  merchantId: string | undefined;
  nextStatus: BlogPostStatus;
  publishedAt: string | null;
  title: string;
}

// Module-scope helpers keep try/finally and throw-in-try out of the component
// body so React Compiler can memoize the screen (it cannot lower that syntax).
async function fetchBlogPost(id: string, merchantId: string) {
  const { data, error } = await supabase
    .from('blog_posts')
    .select(
      'title, excerpt, category, featured_image_url, status, published_at'
    )
    .eq('id', id)
    .eq('merchant_id', merchantId)
    .single();

  if (error) throw error;
  return data;
}

async function persistBlogPost({
  category,
  excerpt,
  featuredImage,
  id,
  merchantId,
  nextStatus,
  publishedAt,
  title,
}: PersistBlogPostInput): Promise<string | null> {
  if (!merchantId) {
    throw new Error('Merchant ID is missing');
  }

  const nextPublishedAt =
    nextStatus === 'published'
      ? publishedAt || new Date().toISOString()
      : publishedAt;

  const payload = {
    title,
    excerpt,
    category,
    featured_image_url: featuredImage,
    status: nextStatus,
    published_at: nextPublishedAt,
    merchant_id: merchantId,
    updated_at: new Date().toISOString(),
  };

  if (id === 'new') {
    // Create
    // Minimal required fields
    const { error } = await supabase.from('blog_posts').insert([
      {
        ...payload,
        slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      },
    ]);
    if (error) throw error;
  } else {
    // Update
    const { error } = await supabase
      .from('blog_posts')
      .update(payload)
      .eq('id', id)
      .eq('merchant_id', merchantId);
    if (error) throw error;
  }

  return nextPublishedAt;
}

async function deleteBlogPost(
  id: string,
  merchantId: string | undefined
): Promise<void> {
  if (!id) {
    throw new Error('Post ID is missing');
  }
  if (!merchantId) {
    throw new Error('Merchant ID is missing');
  }

  const { error } = await supabase
    .from('blog_posts')
    .delete()
    .eq('id', id)
    .eq('merchant_id', merchantId);

  if (error) {
    throw error;
  }
}

export default function BlogPostDetailScreen() {
  const rawParams = useLocalSearchParams();
  const { colors } = useTheme();
  const { merchant } = useMerchant();

  // Validate route params with Zod
  const paramsResult = routeParamsSchema.safeParse(rawParams);
  const validatedParams = paramsResult.success ? paramsResult.data : null;

  // Extract id safely (will be undefined if validation fails)
  const id = validatedParams?.id;

  // Only existing posts need a fetch, so 'new'/invalid ids start ready —
  // avoids a synchronous setState inside the effect for that branch.
  const [isLoading, setIsLoading] = useState(() => Boolean(id) && id !== 'new');
  const [isSaving, setIsSaving] = useState(false);

  // Form State
  const [title, setTitle] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [category, setCategory] = useState('');
  const [featuredImage, setFeaturedImage] = useState('');
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
  const [status, setStatus] = useState<BlogPostStatus>('draft');

  useEffect(() => {
    if (!id || id === 'new') return;
    if (!merchant?.id) return;

    fetchBlogPost(id, merchant.id)
      .then((data) => {
        setTitle(data.title);
        setExcerpt(data.excerpt || '');
        setCategory(data.category || '');
        setFeaturedImage(data.featured_image_url || '');
        setPublishedAt(data.published_at || null);
        setStatus(data.status);
      })
      .catch((e: unknown) => {
        console.error(e);
        Alert.alert('Error', 'Failed to load post');
        router.back();
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [id, merchant?.id]);

  // Show error screen for invalid route params (after all hooks)
  if (!validatedParams) {
    return (
      <InvalidRouteScreen
        title="Invalid Blog Post"
        message="The blog post ID is invalid. Please check the link and try again."
      />
    );
  }

  const handlePickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], // Updated to match type
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      uploadImage(result.assets[0].uri);
    }
  };

  const uploadImage = (uri: string) => {
    setIsSaving(true);
    return uploadBlogImage(uri, merchant?.id)
      .then((publicUrl) => {
        setFeaturedImage(publicUrl);
      })
      .catch((e: unknown) => {
        Alert.alert(
          'Upload Failed',
          e instanceof Error ? e.message : 'Failed to upload image'
        );
      })
      .finally(() => {
        setIsSaving(false);
      });
  };

  const persistPost = (nextStatus: BlogPostStatus = status) => {
    setIsSaving(true);
    return persistBlogPost({
      category,
      excerpt,
      featuredImage,
      id,
      merchantId: merchant?.id,
      nextStatus,
      publishedAt,
      title,
    })
      .then((nextPublishedAt) => {
        setStatus(nextStatus);
        setPublishedAt(nextPublishedAt);
        router.back();
      })
      .catch((e: unknown) => {
        Alert.alert(
          'Error',
          e instanceof Error ? e.message : 'Failed to save blog post'
        );
      })
      .finally(() => {
        setIsSaving(false);
      });
  };

  const handleSave = async () => {
    await persistPost();
  };

  const handlePublishToggle = async () => {
    await persistPost(status === 'published' ? 'draft' : 'published');
  };

  const handlePreview = () => {
    if (id === 'new') {
      Alert.alert(
        'Save post first',
        'Save this post before opening the mobile preview.'
      );
      return;
    }

    router.push({
      pathname: '/blog/preview',
      params: { id },
    });
  };

  const handleDelete = () => {
    if (!id) {
      Alert.alert('Error', 'Blog post ID is missing.');
      return;
    }

    Alert.alert('Delete Post', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          deleteBlogPost(id, merchant?.id)
            .then(() => {
              router.back();
            })
            .catch((e: unknown) => {
              console.error('Failed to delete blog post:', e);
              Alert.alert(
                'Error',
                'Failed to delete blog post. Please try again.'
              );
            }),
      },
    ]);
  };

  if (isLoading)
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.background,
        }}
      >
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top']}
    >
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.backButton,
            pressed && { opacity: 0.7 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Go Back"
          accessibilityHint="Navigates to the previous screen"
        >
          <Ionicons name="close" size={24} color={colors.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          {id === 'new' ? 'New Post' : 'Edit Post'}
        </Text>
        <Pressable
          onPress={handleSave}
          disabled={isSaving}
          style={({ pressed }) => [pressed && { opacity: 0.7 }]}
          accessibilityRole="button"
          accessibilityLabel="Save Post"
          accessibilityState={{ disabled: isSaving }}
        >
          {isSaving ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Text style={[styles.saveText, { color: colors.primary }]}>
              Save
            </Text>
          )}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Image Section */}
        <Pressable
          onPress={handlePickImage}
          style={[
            styles.imageContainer,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          {featuredImage ? (
            <>
              <SafeImage
                source={{ uri: featuredImage }}
                style={styles.featuredImage}
                contentFit="cover"
                transition={200}
              />
              <View style={styles.editBadge}>
                <Ionicons name="camera" size={16} color="white" />
              </View>
            </>
          ) : (
            <View style={styles.imagePlaceholder}>
              <Ionicons
                name="image-outline"
                size={40}
                color={colors.textMuted}
              />
              <Text style={{ color: colors.textMuted, marginTop: 8 }}>
                Add Cover Image
              </Text>
            </View>
          )}
        </Pressable>

        {/* Status Toggles */}
        <View
          style={[
            styles.section,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.label, { color: colors.textSecondary }]}>
            STATUS
          </Text>
          <View style={styles.statusRow}>
            {(['draft', 'published', 'archived'] as const).map((s) => (
              <Pressable
                key={s}
                onPress={() => setStatus(s)}
                style={[
                  styles.statusButton,
                  status === s && { backgroundColor: colors.primaryLight },
                  {
                    borderColor: status === s ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.statusText,
                    { color: status === s ? colors.primary : colors.textMuted },
                  ]}
                >
                  {s.toUpperCase()}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Fields */}
        <View
          style={[
            styles.section,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.label, { color: colors.textSecondary }]}>
            TITLE <Text style={{ color: '#EF4444' }}>*</Text>
          </Text>
          <TextInput
            style={[
              styles.input,
              { color: colors.text, borderColor: colors.border },
            ]}
            value={title}
            onChangeText={setTitle}
            placeholder="Post Title"
            placeholderTextColor={colors.textMuted}
            multiline
          />

          <Text
            style={[
              styles.label,
              { color: colors.textSecondary, marginTop: 16 },
            ]}
          >
            CATEGORY <Text style={{ color: '#EF4444' }}>*</Text>
          </Text>
          <TextInput
            style={[
              styles.input,
              { color: colors.text, borderColor: colors.border },
            ]}
            value={category}
            onChangeText={setCategory}
            placeholder="e.g. Tech News"
            placeholderTextColor={colors.textMuted}
          />

          <Text
            style={[
              styles.label,
              { color: colors.textSecondary, marginTop: 16 },
            ]}
          >
            EXCERPT
          </Text>
          <TextInput
            style={[
              styles.textArea,
              { color: colors.text, borderColor: colors.border },
            ]}
            value={excerpt}
            onChangeText={setExcerpt}
            placeholder="Short summary..."
            placeholderTextColor={colors.textMuted}
            multiline
            textAlignVertical="top"
          />
        </View>

        {/* Content Actions */}
        <View style={{ marginBottom: SPACING.lg }}>
          <Pressable
            onPress={handlePublishToggle}
            disabled={isSaving}
            style={({ pressed }) => [
              styles.publishButton,
              {
                backgroundColor:
                  status === 'published' ? colors.warning : colors.primary,
              },
              pressed && { opacity: 0.7 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={
              status === 'published' ? 'Unpublish Article' : 'Publish Article'
            }
            accessibilityState={{ disabled: isSaving }}
          >
            <Ionicons
              name={status === 'published' ? 'archive-outline' : 'send'}
              size={20}
              color="#FFFFFF"
            />
            <Text style={styles.publishButtonText}>
              {status === 'published' ? 'Unpublish Article' : 'Publish Article'}
            </Text>
          </Pressable>

          <Pressable
            onPress={handlePreview}
            style={({ pressed }) => [
              styles.actionButton,
              { backgroundColor: colors.card, borderColor: colors.primary },
              pressed && { opacity: 0.7 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Preview Article"
            accessibilityHint="Shows a preview of the article"
          >
            <Ionicons name="eye-outline" size={20} color={colors.primary} />
            <Text style={[styles.actionText, { color: colors.primary }]}>
              Preview Article
            </Text>
          </Pressable>

          <Pressable
            onPress={() =>
              router.push({
                pathname: '/blog/edit-content',
                params: { id },
              })
            }
            style={[
              styles.actionButton,
              { backgroundColor: colors.card, borderColor: colors.primary },
            ]}
          >
            <Ionicons name="create-outline" size={20} color={colors.primary} />
            <Text style={[styles.actionText, { color: colors.primary }]}>
              Edit Content
            </Text>
          </Pressable>
        </View>

        {id !== 'new' && (
          <Pressable
            onPress={handleDelete}
            style={[
              styles.deleteButton,
              { backgroundColor: colors.errorLight },
            ]}
          >
            <Text style={[styles.deleteText, { color: colors.error }]}>
              Delete Post
            </Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
  },
  backButton: { padding: 4 },
  headerTitle: {
    fontSize: TYPOGRAPHY.size.lg,
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
  },
  saveText: {
    fontSize: TYPOGRAPHY.size.md,
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
  },
  content: {
    padding: SPACING.lg,
  },

  // Image
  imageContainer: {
    height: 200,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    borderWidth: 1,
    marginBottom: SPACING.lg,
    borderStyle: 'dashed',
  },
  featuredImage: {
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editBadge: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 8,
    borderRadius: 20,
  },

  // Forms
  section: {
    padding: SPACING.lg,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    marginBottom: SPACING.lg,
  },
  label: {
    fontSize: TYPOGRAPHY.size.xs,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  input: {
    fontSize: TYPOGRAPHY.size.md,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
    padding: 12,
    borderWidth: 1,
    borderRadius: RADIUS.md,
  },
  textArea: {
    fontSize: TYPOGRAPHY.size.md,
    fontFamily: TYPOGRAPHY.fontFamily.regular,
    padding: 12,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    minHeight: 100,
  },

  // Status
  statusRow: {
    flexDirection: 'row',
    gap: SPACING.md,
  },
  statusButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: RADIUS.md,
  },
  statusText: {
    fontSize: TYPOGRAPHY.size.xs,
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
  },

  // Actions
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    marginBottom: SPACING.md,
    gap: 8,
  },
  actionText: {
    fontSize: TYPOGRAPHY.size.md,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
  },
  publishButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    marginBottom: SPACING.md,
    gap: 8,
  },
  publishButtonText: {
    color: '#FFFFFF',
    fontSize: TYPOGRAPHY.size.md,
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
  },
  deleteButton: {
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    alignItems: 'center',
    marginTop: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  deleteText: {
    fontSize: TYPOGRAPHY.size.md,
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
  },
  note: {
    textAlign: 'center',
    fontSize: TYPOGRAPHY.size.xs,
    marginBottom: 40,
    paddingHorizontal: 20,
  },
});
