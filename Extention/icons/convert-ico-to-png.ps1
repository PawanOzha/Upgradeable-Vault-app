# PowerShell script to convert ICO to PNG files
# Extracts frames from ICO and saves as PNG

param(
    [string]$icoPath = "favicon.ico"
)

Add-Type -AssemblyName System.Drawing

# Load the ICO file
$ico = [System.Drawing.Icon]::new($icoPath)

# Sizes we need
$sizes = @(16, 48, 128)

foreach ($size in $sizes) {
    Write-Host "Creating icon${size}.png..."

    # Convert icon to bitmap
    $bitmap = $ico.ToBitmap()

    # Create a new bitmap with the target size
    $resizedBitmap = New-Object System.Drawing.Bitmap($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($resizedBitmap)

    # Use high quality settings
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    # Draw the resized image
    $graphics.DrawImage($bitmap, 0, 0, $size, $size)

    # Save as PNG
    $resizedBitmap.Save("icon${size}.png", [System.Drawing.Imaging.ImageFormat]::Png)

    # Cleanup
    $graphics.Dispose()
    $resizedBitmap.Dispose()
    $bitmap.Dispose()

    Write-Host "Created icon${size}.png" -ForegroundColor Green
}

$ico.Dispose()

Write-Host ""
Write-Host "All icons created successfully!" -ForegroundColor Green
Write-Host "You can now load the extension in your browser." -ForegroundColor Yellow
