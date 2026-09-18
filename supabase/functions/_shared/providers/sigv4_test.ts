import { presign } from './sigv4.ts'

// AWS's own example: https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
Deno.test('presign matches the AWS documentation vector', async () => {
  const url = await presign({
    method: 'GET',
    host: 'examplebucket.s3.amazonaws.com',
    path: '/test.txt',
    region: 'us-east-1',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    expires: 86400,
    date: new Date('2013-05-24T00:00:00Z'),
  })
  const sig = new URL(url).searchParams.get('X-Amz-Signature')
  if (sig !== 'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404') throw new Error(`got ${sig}`)
})
