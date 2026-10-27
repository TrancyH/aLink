plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.amoolink.notes"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.amoolink.notes"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    packaging {
        // 编辑器 bundle 较大,不压缩以便 WebView mmap(可选优化)
        resources.excludes += setOf()
    }
}

dependencies {
    // 零外部依赖:WebView/JSON(org.json)均为框架能力
}
