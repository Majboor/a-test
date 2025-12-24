import * as THREE from 'three'
import progressPromise from '../utils/progressPromise'
import assetMapping from '../config/assetMapping'

export default class AssetLoader {

    constructor( isMobile ) {

        this.isMobile = isMobile
        this.assets = {
            textures: {},
            fonts: {}
        }
        this.assetList = {}
        this.renderer = null
        this.progressEl = document.querySelector( '.progress-percent' )
        this.progressBar = document.querySelector( '.progress-circle .line' )
        this.loadingAssetEl = document.querySelector( '.loading-asset' )
        this.videosToLoad = 0
        this.totalAssets = 0
        this.loadedAssets = 0
        this.currentAsset = ''
        this.baseUrl = 'http://164.68.117.31/waleeds.world/'

    }

    getAssetUrl( month, filename ) {
        // Local assets (intro, end, ui) should always use local paths
        if( month === 'intro' || month === 'end' || month === 'ui' ) {
            // Use leading slash for webpack-dev-server
            // UI assets are in UI/screenshots folder
            if( month === 'ui' ) {
                return `/assets/UI/screenshots/${filename}`
            }
            return `/assets/${month}/${filename}`
        }
        // Check if we have a mapping for this asset
        if( assetMapping[ month ] && assetMapping[ month ][ filename ] ) {
            // Properly encode the path (handles spaces and special characters)
            const pathParts = assetMapping[ month ][ filename ].split('/')
            const encodedPath = pathParts.map(part => encodeURIComponent(part)).join('/')
            const mappedUrl = this.baseUrl + encodedPath
            console.log(`Using mapped URL for ${month}/${filename}: ${mappedUrl}`)
            return mappedUrl
        }
        // Fallback to local assets (shouldn't happen for mapped assets)
        const fallbackUrl = `/assets/${month}/${filename}`
        console.warn(`No mapping found for ${month}/${filename}, using fallback: ${fallbackUrl}`)
        return fallbackUrl
    }

    load( assetList, renderer ) {

        this.assetList = assetList
        this.renderer = renderer

        let assetLoadPromises = []

        // Count total assets first
        for( let month in this.assetList ) {
            this.totalAssets += this.assetList[month].length
        }

        // Load images + videos
        let imageLoader = new THREE.TextureLoader()
        imageLoader.crossOrigin = ''

        let preload = true

        for( let month in this.assetList ) {

            // preload = month === 'intro' ? true : false

            this.assetList[month].forEach( filename => {
                
                // Update current asset display
                let assetPath = filename
                if( month !== 'intro' && month !== 'end' && assetMapping[ month ] && assetMapping[ month ][ filename ] ) {
                    assetPath = assetMapping[ month ][ filename ]
                }
                this.currentAsset = `${month}/${assetPath}`
                this.updateAssetDisplay()

                if( ~filename.indexOf( '.mp4' ) ) {

                    let video = document.createElement( 'video' );
                    video.style = 'position:absolute;height:0'
                    video.muted = true
                    video.autoplay = false
                    video.loop = true
                    
                    // Only set crossOrigin for external URLs, not local files
                    const assetUrl = this.getAssetUrl( month, filename )
                    if( assetUrl.startsWith('http') ) {
                    video.crossOrigin = 'anonymous'
                    }
                    
                    video.setAttribute('muted', true)
                    video.setAttribute('webkit-playsinline', true)
                    video.setAttribute('playsinline', true)
                    video.preload = 'metadata'
                    
                    // Special handling for local videos
                    const isLocalVideo = month === 'intro' || month === 'end'
                    if( isLocalVideo ) {
                        // For local videos, use 'auto' preload to ensure it loads
                        video.preload = 'auto'
                        console.log(`Loading LOCAL video: ${assetUrl} (month: ${month}, filename: ${filename})`)
                    } else {
                        console.log(`Loading video: ${assetUrl} (month: ${month}, filename: ${filename})`)
                    }
                    
                    video.src = assetUrl
                    document.body.appendChild( video )
                    
                    // For local videos, load immediately; for external, wait a bit
                    if( isLocalVideo ) {
                        video.load() // Load immediately for local files
                    } else {
                        // Wait a bit for the video element to be ready before loading
                        setTimeout(() => {
                    video.load() // must call after setting/changing source
                        }, 10)
                    }

                    if( preload ) {

                        assetLoadPromises.push( new Promise( (resolve, reject) => {
                            // For local videos, start immediately; for external, wait a bit
                            const delay = isLocalVideo ? 10 : 50
                            setTimeout(() => {
                                this.videoPromise( video, month, filename, resolve, reject )
                            }, delay)
                        } ) )

                    } else {

                        this.createVideoTexture( video, month, filename, false )

                    }

                } else {

                    if( preload ) {

                        assetLoadPromises.push( new Promise( (resolve, reject) => {
                            const assetUrl = this.getAssetUrl( month, filename )
                            imageLoader.load( 
                                assetUrl, 
                                texture => {
                                    this.loadedAssets++
                                    this.updateAssetDisplay()
                                    this.createImageTexture( texture, month, filename, resolve )
                                },
                                undefined,
                                error => {
                                    console.error(`Failed to load image: ${assetUrl}`, error)
                                    this.updateAssetDisplay(`ERROR: ${assetUrl}`)
                                    reject( error )
                                }
                            )
                        }))

                    } else {

                        const assetUrl = this.getAssetUrl( month, filename )
                        let texture = new THREE.TextureLoader().load( assetUrl, texture => {
                            texture.size = new THREE.Vector2( texture.image.width / 2, texture.image.height / 2 )
                            texture.needsUpdate = true
                            this.renderer.setTexture2D( texture, 0 )
                        } )
                        texture.size = new THREE.Vector2( 10, 10 )
                        texture.name = `${month}/${filename}`
                        texture.mediaType = 'image'
                        texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
                        if( !this.assets.textures[ month ] ) this.assets.textures[ month ] = {}
                        this.assets.textures[ month ][ filename ] = texture

                    }

                }

            })

        }

        // Load Fonts
        let fontLoader = new THREE.FontLoader()
        let fonts = [
            'fonts/schnyder.json',
            'fonts/schnyder-outline.json',
            'fonts/suisse.json',
        ]

        for( let i = 0; i < fonts.length; i++ ) {
            assetLoadPromises.push( new Promise( resolve => fontLoader.load( fonts[i], font => {
                this.assets.fonts[ font.data.familyName ] = font
                resolve() 
            } ) ) )
        }

        return new Promise( resolve => {
            progressPromise( assetLoadPromises, this.update.bind(this) ).then( () => {
                resolve( this.assets )
            });
        })

    }

    update( completed, total ) {

        let progress = Math.round( completed / total * 100 )
        this.progressEl.innerHTML = progress + '%'
        this.progressBar.style.strokeDashoffset = 252.363 - ( 252.363 * ( completed / total ) )
        this.loadedAssets = completed

    }

    updateAssetDisplay( errorMessage = null ) {
        
        if( this.loadingAssetEl ) {
            if( errorMessage ) {
                this.loadingAssetEl.innerHTML = `<span style="color: #ff0000;">${errorMessage}</span>`
            } else {
                const progress = this.totalAssets > 0 
                    ? `(${this.loadedAssets}/${this.totalAssets})` 
                    : ''
                const displayText = this.currentAsset 
                    ? `Loading: ${this.currentAsset} ${progress}` 
                    : `Loading assets... ${progress}`
                this.loadingAssetEl.innerHTML = displayText
            }
        }
        
    }

    videoPromise( video, month, filename, resolve, reject, retry ) {

        // Special handling for local videos (intro/end)
        const isLocalVideo = month === 'intro' || month === 'end'

        if( retry ) {
            video.load()
            this.updateAssetDisplay(`Retrying: ${this.currentAsset}`)
        }

        // Longer timeout for local videos, much longer for external (live site may have slow connections)
        const timeoutDuration = isLocalVideo ? 120000 : 180000 // 2 min for local, 3 min for external videos

        // Add timeout to prevent infinite waiting
        const timeout = setTimeout(() => {
            if( successCalled ) return // Don't timeout if already succeeded
            console.error(`Video loading timeout: ${video.src}`)
            this.updateAssetDisplay(`TIMEOUT: ${video.src}`)
            cleanup()
            // Don't reject - just log the error and continue loading other assets
            // This allows the page to load even if some videos fail
            if( resolve ) {
                // Create a placeholder texture instead of null
                // This prevents blocking the entire loading process
                console.warn(`Creating placeholder for failed video: ${video.src}`)
                this.loadedAssets++
                this.updateAssetDisplay()
                const placeholderTexture = this.createPlaceholderTexture( month, filename, 'video' )
                resolve( placeholderTexture ) // Resolve with placeholder to continue
            }
        }, timeoutDuration)

        let checkInterval = null
        const cleanup = () => {
            clearTimeout(timeout)
            if( checkInterval ) clearInterval(checkInterval)
            video.oncanplaythrough = null
            video.onloadeddata = null
            video.onerror = null
            video.onloadedmetadata = null
            video.onprogress = null
            video.oncanplay = null
            video.onloadstart = null
        }

        let successCalled = false
        const onSuccess = () => {
            if( successCalled ) return // Prevent multiple calls
            successCalled = true
            cleanup()
            this.loadedAssets++
            this.updateAssetDisplay()
            try {
                this.createVideoTexture( video, month, filename, resolve )
            } catch( error ) {
                console.error(`Error creating video texture for ${video.src}:`, error)
                // Create placeholder texture instead of null
                const placeholderTexture = this.createPlaceholderTexture( month, filename, 'video' )
                resolve( placeholderTexture )
            }
        }

        const onError = (error) => {
            cleanup()
            console.error(`Failed to load video: ${video.src}`, error)
            console.error(`Video readyState: ${video.readyState}`, `Video networkState: ${video.networkState}`)
            this.updateAssetDisplay(`ERROR: ${video.src}`)
            // Don't block loading - create placeholder texture instead of null
            // This allows other assets to load even if this video fails
            console.warn(`Creating placeholder for failed video: ${video.src}`)
            this.loadedAssets++
            this.updateAssetDisplay()
            const placeholderTexture = this.createPlaceholderTexture( month, filename, 'video' )
            resolve( placeholderTexture ) // Resolve with placeholder instead of null
        }

        // Special handling for local videos - they may need different event handling
        if( isLocalVideo ) {
            console.log(`Setting up local video handlers for: ${video.src}`)
            
            // Check immediately if video is already ready
            const checkIfReady = () => {
                if( !successCalled && video.readyState >= 2 && video.duration > 0 ) {
                    if( video.videoWidth > 0 && video.videoHeight > 0 ) {
                        console.log(`Local video already ready: ${video.src}`)
                        onSuccess()
                        return true
                    }
                }
                return false
            }

            // Check immediately
            if( checkIfReady() ) return

            // For local videos, try multiple events and be more lenient
            video.onloadedmetadata = () => {
                console.log(`Local video metadata loaded: ${video.src}`, {
                    readyState: video.readyState,
                    duration: video.duration,
                    videoWidth: video.videoWidth,
                    videoHeight: video.videoHeight
                })
                // For local videos, if we have metadata and dimensions, we're good
                if( video.readyState >= 2 && video.duration > 0 ) {
                    // Wait a bit for dimensions if not available yet
                    if( video.videoWidth > 0 && video.videoHeight > 0 ) {
                        onSuccess()
                    } else {
                        // Try again after a short delay
                        setTimeout(() => {
                            if( !successCalled && video.videoWidth > 0 && video.videoHeight > 0 ) {
                                onSuccess()
                            }
                        }, 100)
                    }
                }
            }

            video.onloadeddata = () => {
                console.log(`Local video data loaded: ${video.src}`, {
                    readyState: video.readyState,
                    videoWidth: video.videoWidth,
                    videoHeight: video.videoHeight
                })
                if( video.readyState >= 3 ) {
                    onSuccess()
                } else if( video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0 ) {
                    // Even if not fully loaded, if we have dimensions, proceed
                    onSuccess()
                }
            }

            video.oncanplay = () => {
                console.log(`Local video can play: ${video.src}`)
                onSuccess()
            }

            video.oncanplaythrough = () => {
                console.log(`Local video can play through: ${video.src}`)
                onSuccess()
            }

            video.onerror = onError

            // For local videos, check periodically if already loaded
            let checkCount = 0
            checkInterval = setInterval(() => {
                checkCount++
                if( checkIfReady() ) {
                    clearInterval(checkInterval)
                    checkInterval = null
                } else if( checkCount > 20 ) {
                    // After 4 seconds (20 * 200ms), give up and try anyway if we have metadata
                    clearInterval(checkInterval)
                    checkInterval = null
                    if( !successCalled && video.readyState >= 2 && video.duration > 0 ) {
                        console.log(`Local video timeout - proceeding with available data: ${video.src}`)
                        onSuccess()
                    }
                }
            }, 200) // Check every 200ms

        } else if( !this.isMobile) {
            // Desktop: use canplaythrough
            video.oncanplaythrough = onSuccess
            video.onerror = onError
            
            // Track progress for external videos
            video.onprogress = () => {
                if( video.buffered.length > 0 ) {
                    const bufferedEnd = video.buffered.end( video.buffered.length - 1 )
                    const duration = video.duration
                    if( duration > 0 ) {
                        const percentLoaded = Math.round( ( bufferedEnd / duration ) * 100 )
                        if( percentLoaded > 0 && percentLoaded < 100 ) {
                            this.updateAssetDisplay(`Loading video: ${percentLoaded}% - ${this.currentAsset}`)
                        }
                    }
                }
            }
            
            // Fallback: also listen to loadeddata
            video.onloadeddata = () => {
                if( video.readyState >= 3 ) { // HAVE_FUTURE_DATA
                    onSuccess()
                }
            }
            
            // Also listen to loadedmetadata for earlier detection
            video.onloadedmetadata = () => {
                if( video.readyState >= 1 && video.videoWidth > 0 && video.videoHeight > 0 ) {
                    // If we have metadata and dimensions, we can proceed
                    // This helps with slow connections
                    setTimeout(() => {
                        if( !successCalled && video.readyState >= 2 ) {
                            onSuccess()
                        }
                    }, 500)
                }
            }
            
            // Also listen to loadedmetadata as fallback
            video.onloadedmetadata = () => {
                if( video.readyState >= 2 ) { // HAVE_METADATA
                    // For some videos, metadata might be enough
                    if( video.duration > 0 && video.videoWidth > 0 ) {
                        onSuccess()
                    }
                }
            }
        } else {
            // Mobile: use loadeddata
            video.onloadeddata = () => {
                video.onerror = null
                onSuccess()
            }

            video.onerror = onError
            
            // Also try loadedmetadata for mobile
            video.onloadedmetadata = () => {
                if( video.readyState >= 2 && video.duration > 0 ) {
                    onSuccess()
                }
            }
        }

        // Add progress listener for debugging
        video.onprogress = () => {
            if( video.buffered.length > 0 ) {
                const bufferedEnd = video.buffered.end( video.buffered.length - 1 )
                const duration = video.duration
                if( duration > 0 ) {
                    const percent = ( bufferedEnd / duration ) * 100
                    this.updateAssetDisplay(`${this.currentAsset} (${Math.round(percent)}% buffered)`)
                }
            }
        }

    }

    createImageTexture( texture, month, filename, resolve ) {
        
        // Store full URL for debugging and consistency
        const assetUrl = this.getAssetUrl( month, filename )
        
        // if preloaded
        if( resolve ) {

            texture.size = new THREE.Vector2( texture.image.width / 2, texture.image.height / 2 )
            texture.needsUpdate = true
            this.renderer.setTexture2D( texture, 0 )

            texture.name = assetUrl // Store full URL
            texture.mediaType = 'image'
            texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy()

            if( !this.assets.textures[ month ] ) this.assets.textures[ month ] = {}
            this.assets.textures[ month ][ filename ] = texture
        
            resolve( texture )

        } else {

            let texture = new THREE.TextureLoader().load( assetUrl, texture => {

                texture.size = new THREE.Vector2( texture.image.width / 2, texture.image.height / 2 )
                texture.needsUpdate = true
                this.renderer.setTexture2D( texture, 0 )

            } )
            texture.size = new THREE.Vector2( 10, 10 )

            texture.name = assetUrl // Store full URL
            texture.mediaType = 'image'
            texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy()

            if( !this.assets.textures[ month ] ) this.assets.textures[ month ] = {}
            this.assets.textures[ month ][ filename ] = texture

        }

    }

    createVideoTexture( video, month, filename, resolve, reject ) {

        // Check if video is valid before creating texture
        if( !video ) {
            console.warn(`Video element is null for: ${month}/${filename}`)
            if( resolve ) {
                // Create a placeholder texture instead of null
                const placeholderTexture = this.createPlaceholderTexture( month, filename, 'video' )
                resolve( placeholderTexture )
            }
            return
        }

        // Wait for video dimensions if not available yet
        if( !video.videoWidth || !video.videoHeight ) {
            // Try to get dimensions from video element
            if( video.readyState >= 2 ) {
                // Video has metadata, dimensions should be available soon
                setTimeout(() => {
                    if( video.videoWidth && video.videoHeight ) {
                        this.createVideoTexture( video, month, filename, resolve, reject )
                    } else {
                        console.warn(`Video dimensions not available: ${video.src}`)
                        if( resolve ) {
                            const placeholderTexture = this.createPlaceholderTexture( month, filename, 'video' )
                            resolve( placeholderTexture )
                        }
                    }
                }, 500)
            } else {
                console.warn(`Video not ready for texture creation: ${video.src}`)
                if( resolve ) {
                    const placeholderTexture = this.createPlaceholderTexture( month, filename, 'video' )
                    resolve( placeholderTexture )
                }
            }
            return
        }

        let texture = new THREE.VideoTexture( video )
        texture.minFilter = texture.magFilter = THREE.LinearFilter
        texture.name = `${month}/${filename}`
        texture.mediaType = 'video'
        texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy()

        // Store full URL for mobile playback
        const assetUrl = this.getAssetUrl( month, filename )
        texture.name = assetUrl

        // if preloaded
        if( resolve ) {

            texture.size = new THREE.Vector2( video.videoWidth / 2, video.videoHeight / 2 )
            this.renderer.setTexture2D( texture, 0 )

            if( !this.isMobile) {
                video.oncanplaythrough = null
            } else {
                video.src = ''
                video.load()
                video.onloadeddata = null
            }

            resolve( texture )

        } else {

            texture.size = new THREE.Vector2( 1, 1 )

            video.oncanplaythrough = () => {
                if( video.videoWidth && video.videoHeight ) {
                    texture.size = new THREE.Vector2( video.videoWidth / 2, video.videoHeight / 2 )
                texture.needsUpdate = true
                }
                video.oncanplaythrough = null
            }

        }

        if( !this.assets.textures[ month ] ) this.assets.textures[ month ] = {}
        this.assets.textures[ month ][ filename ] = texture

    }

    createPlaceholderTexture( month, filename, mediaType ) {
        // Create a simple placeholder texture (1x1 pixel, gray)
        const canvas = document.createElement('canvas')
        canvas.width = 1
        canvas.height = 1
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = '#808080'
        ctx.fillRect(0, 0, 1, 1)
        
        const texture = new THREE.CanvasTexture(canvas)
        texture.size = new THREE.Vector2( 700, 700 ) // Default size
        texture.name = `${month}/${filename}`
        texture.mediaType = mediaType || 'image'
        texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
        
        if( !this.assets.textures[ month ] ) this.assets.textures[ month ] = {}
        this.assets.textures[ month ][ filename ] = texture
        
        console.warn(`Created placeholder texture for failed asset: ${month}/${filename}`)
        return texture
    }


}