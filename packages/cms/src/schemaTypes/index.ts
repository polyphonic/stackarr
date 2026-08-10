import { author } from './documents/author';
import { category } from './documents/category';
import { post } from './documents/post';
import { portableText } from './objects/portableText';
import { seoMetadata } from './objects/seoMetadata';
import { sourceCitation } from './objects/sourceCitation';

export const schemaTypes = [author, category, post, portableText, seoMetadata, sourceCitation];
